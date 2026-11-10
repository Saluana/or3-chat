import { join } from 'node:path';
import { assertExistingVaultCustody } from './vault';
import { readAuthenticatedBackupConfig } from './config';
import { assertSupportedBackupProfile, validateCanonicalBackupReferences } from './references';
import {
  assertRestorableManagedAssets,
  MANAGED_ASSET_INVENTORY_VERSION,
  restoreManagedAssets,
} from '../deployment/assets';
import type { BackupManifest, ManagedState } from '../deployment/contracts';
import { dashboardUpdatesEnabled, parseEnv, restoreStorageConfiguration, secretValues, serializeEnv, withoutDashboardOperator } from '../deployment/env';
import { imageAtDigest } from '../deployment/identity';
import { deploymentPaths } from '../deployment/paths';
import { updatePending } from '../deployment/state-store';
import { removeDashboardOperator } from '../runtime/dashboard-operator';
import { run } from '../runtime/command-runner';
import { containerNodeCommand } from '../runtime/health';
import { pullAndRequireImage, requireImageDigest } from '../runtime/images';
import { startProject, stopProject } from '../runtime/project';
import {
  dataVolumeFreeBytes,
  dataVolumeSize,
  ensureManagedDataVolume,
  removeManagedDataVolumeForRecreation,
  setManagedVolumeRootOwnership,
} from '../runtime/volumes';
import { readText, writeSecure } from '../util/fs';
import { redact } from '../util/primitives';
import {
  assertEnoughFreeSpace,
  gzipUncompressedBytes,
  restoreVolumeArchive,
  validateVolumeArchive,
} from './archive';
import { assertBackupMatchesDeployment, readManifest, recordedBackupPath } from './manifests';
import { rebindRestoredGenerations } from './generation-restore';
import { checkRemoteCopyTarget, checkRemoteTarget } from './remote';

/** Offline only: the managed caller has stopped writers and extracted this backup. */
export async function restoreGenerationIdentities(directory: string, state: ManagedState, env: Record<string, string>, backupPath: string, options: { previousSafetySnapshot?: boolean } = {}) {
  await readManifest(backupPath, directory);
  const script = `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(process.env.OR3_STORAGE_FS_ROOT || '/data/storage');
if (root !== '/data' && !root.startsWith('/data/')) throw new Error('Generation restore requires managed storage');
{
  const Database = require('/app/.output/server/node_modules/better-sqlite3');
  const db = new Database(process.env.OR3_SQLITE_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Restored SQLite integrity check failed');
    (${rebindRestoredGenerations.toString()})(fs, path, crypto, db, root, ${JSON.stringify({ previousSafetySnapshot: options.previousSafetySnapshot === true })});
  } finally { db.close(); }
}`;
  const result = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
    '-v', `${state.volumeName}:/data`, '--env', `OR3_SQLITE_DB_PATH=${env.OR3_SQLITE_DB_PATH ?? ''}`,
    '--env', `OR3_STORAGE_FS_ROOT=${env.OR3_STORAGE_FS_ROOT ?? '/data/storage'}`,
    '--entrypoint', 'sh', env.OR3_IMAGE!, ...containerNodeCommand(script).slice(1),
  ], directory);
  if (!result.ok) throw new Error(`Restored generation verification failed. ${redact(result.stderr, secretValues(env))}`);
}

/** Verify committed filesystem objects against the existing content-hash key. */
export function assertFilesystemPayloadHash(
  key: string,
  readChunk: () => Uint8Array | undefined,
  createHash: (algorithm: 'sha256' | 'md5') => { update: (bytes: Uint8Array) => unknown; digest: (encoding: 'hex') => string },
) {
  const match = /^(sha256|md5)_([a-fA-F0-9]+)$/.exec(key);
  const algorithm = match?.[1];
  const expected = match?.[2];
  if ((algorithm !== 'sha256' && algorithm !== 'md5') || expected?.length !== (algorithm === 'sha256' ? 64 : 32)) {
    throw new Error('Invalid canonical filesystem payload key');
  }
  const hash = createHash(algorithm);
  for (let chunk = readChunk(); chunk !== undefined; chunk = readChunk()) hash.update(chunk);
  if (hash.digest('hex') !== expected.toLowerCase()) throw new Error('Filesystem payload hash mismatch');
}

// Deep health only opens database files; that also succeeds for a non-SQLite
// payload. Startup can also initialize an empty database. Use the restored
// image's native driver and filesystem content hashes before application startup,
// without imposing current-release ownership on legitimate older snapshots.
const VERIFY_RESTORED_DATA_SCRIPT = `
const fs = require('node:fs');
const Database = require('/app/.output/server/node_modules/better-sqlite3');
const validFilesystemPayload = ${assertFilesystemPayloadHash.toString()};
const auth = process.env.AUTH_PROVIDER || 'basic-auth', storage = process.env.NUXT_PUBLIC_STORAGE_PROVIDER || 'fs';
if (!(auth === 'basic-auth' && storage === 'fs' || auth === 'clerk' && storage === 's3')) throw new Error('Unsupported restored provider profile');
const paths = auth === 'basic-auth' ? [process.env.OR3_BASIC_AUTH_DB_PATH, process.env.OR3_SQLITE_DB_PATH] : [process.env.OR3_SQLITE_DB_PATH];
if (paths.some(path => !path)) throw new Error('Managed database paths must be configured');
for (const path of paths) {
  const databasePath = fs.realpathSync(path);
  if (!fs.statSync(databasePath).isFile()) throw new Error('Restored database payload must be a regular file');
  const walPath = databasePath + '-wal';
  if (fs.existsSync(walPath)) {
    const info = fs.statSync(walPath);
    if (!info.isFile()) throw new Error('Restored WAL payload must be a regular file');

  }
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite quick_check failed');
    const tables = db.prepare("select count(*) as count from sqlite_master where type = 'table'").get().count;
    if (tables < 1) throw new Error('Restored database has no tables');
  } finally { db.close(); }
}
const path = require('node:path');
const crypto = require('node:crypto');
const storageRoot = path.resolve(process.env.OR3_STORAGE_FS_ROOT || '/data/storage');
const workspacesRoot = path.join(storageRoot, 'workspaces');
if (storage === 'fs' && (storageRoot === '/data' || storageRoot.startsWith('/data/')) && fs.existsSync(workspacesRoot)) {
  const chunk = Buffer.alloc(65536);
  for (const workspace of fs.readdirSync(workspacesRoot, { withFileTypes: true }).filter(entry => /^[a-zA-Z0-9_-]+$/.test(entry.name))) {
    const directory = path.join(workspacesRoot, workspace.name);
    if (!fs.statSync(directory).isDirectory()) continue;
    for (const entry of fs.readdirSync(directory)) {
      if (!/^(sha256_[a-fA-F0-9]{64}|md5_[a-fA-F0-9]{32})[.]meta[.]json$/.test(entry)) continue;
      const key = entry.slice(0, -10);
      const file = path.join(directory, key);
      if (!fs.statSync(file).isFile()) throw new Error('Restored filesystem payload must be a regular file');
      const fd = fs.openSync(file, 'r');
      try {
        validFilesystemPayload(key, () => {
          const count = fs.readSync(fd, chunk, 0, chunk.length, null);
          return count ? chunk.subarray(0, count) : undefined;
        }, algorithm => crypto.createHash(algorithm));
      } finally { fs.closeSync(fd); }
    }
  }
}
`;

export async function assertRestoreFreeSpace(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  manifest: BackupManifest,
  backupPath: string,
) {
  const archiveBytes = await gzipUncompressedBytes(join(backupPath, 'data.tgz'));
  const requiredBytes = Math.max(manifest.dataBytes ?? 0, archiveBytes);
  const freeBytes = await dataVolumeFreeBytes(directory, state.mode, env);
  // Extraction first replaces the current managed volume contents. Its used
  // bytes are reclaimable capacity, unlike a backup archive written beside it.
  const reclaimableBytes = await dataVolumeSize(directory, state.mode, env, 'allocated');
  assertEnoughFreeSpace(freeBytes + reclaimableBytes, requiredBytes, 'Restore');
}

export async function restoreBackupData(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  backupPath: string,
  options: { recreateDataVolume?: boolean; beforeStart?: () => Promise<void>; previousSafetySnapshot?: boolean; remoteReferencePolicy?: 'warn' } = {},
) {
  const manifest = await readManifest(backupPath, directory);
  assertRestorableManagedAssets(manifest);
  const backupConfig = await readAuthenticatedBackupConfig(backupPath, manifest);
  const backupEnv = parseEnv(backupConfig);
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, state, env);
  if (manifest.schemaVersion === 1) assertSupportedBackupProfile(backupEnv);
  else if ((!options.beforeStart && options.remoteReferencePolicy !== 'warn') ||
      (options.remoteReferencePolicy === 'warn' && (!options.previousSafetySnapshot || options.beforeStart)) ||
      (options.previousSafetySnapshot && manifest.remote.kind !== 's3-reference-v1')) {
    throw new Error('S3 restore requires a journaled startup or a reference-only safety snapshot.');
  }
  if (manifest.imageDigest) await requireImageDigest(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  await assertExistingVaultCustody(directory, state, manifest, backupPath, backupConfig);
  await validateVolumeArchive(directory, state.mode, env, backupPath, backupEnv.OR3_STORAGE_FS_ROOT);
  if (manifest.schemaVersion === 2 && manifest.remote.kind === 's3-copy-v1') {
    const result = await checkRemoteCopyTarget(directory, manifest, env, backupPath, manifest.remote);
    if (result.missing || result.mismatched) throw new Error('S3 restore target has missing or mismatched objects.');
  } else if (manifest.schemaVersion === 2 && manifest.remote.kind === 's3-reference-v1') {
    const result = await checkRemoteTarget(directory, manifest, env, backupPath, manifest.remote);
    if (result.missing || result.mismatched) {
      if (options.remoteReferencePolicy !== 'warn') throw new Error('S3 reference target has missing or mismatched objects.');
      console.warn(`Restoring the pre-mutation snapshot with ${result.missing} missing and ${result.mismatched} mismatched S3 objects; attachment completeness is not certified.`);
    }
  } else if (!options.previousSafetySnapshot) {
    await validateCanonicalBackupReferences(directory, { ...backupEnv, OR3_IMAGE: imageAtDigest(manifest.image, manifest.imageDigest) }, backupPath);
  } else {
    // Recovery preserves the exact prior byte state, including pre-existing
    // missing objects. Requiring semantic completeness would prevent repairing
    // that state and make otherwise usable older-image snapshots unrecoverable.
    console.warn('Restoring the recorded byte-preservation safety snapshot; canonical attachment completeness is not certified. Verify previously uploaded files.');
  }
  await ensureManagedDataVolume(directory, state.mode, state, env);
  // Preflight the filesystem Docker will actually extract into. A compressed
  // tarball's byte size and the backup directory's filesystem cannot prove
  // there is room in /data.
  await assertRestoreFreeSpace(directory, state, env, manifest, backupPath);
  // An inventory older than v3 cannot safely re-enable the overlay: its
  // archived assets do not contain compose.operator.yaml. Treat it as a
  // CLI-only snapshot rather than leaving an orphaned Docker-socket sidecar.
  const restoresOperatorOverlay = [3, MANAGED_ASSET_INVENTORY_VERSION].includes(manifest.managedAssetInventoryVersion ?? 1)
    && Boolean(manifest.managedAssetSha256?.['compose.operator.yaml']);
  const restoredEnv = restoresOperatorOverlay
    ? {
        ...restoreStorageConfiguration(backupEnv, env),
        OR3_IMAGE: imageAtDigest(manifest.image, manifest.imageDigest),
      }
    : withoutDashboardOperator({
        ...restoreStorageConfiguration(backupEnv, env),
        OR3_IMAGE: imageAtDigest(manifest.image, manifest.imageDigest),
      });

  if (options.recreateDataVolume) await removeManagedDataVolumeForRecreation(directory, state);
  else await stopProject(directory, state.mode);
  if (
    dashboardUpdatesEnabled(directory)
    && restoredEnv.OR3_DASHBOARD_UPDATES_ENABLED !== 'true'
    && !process.env.OR3_DASHBOARD_UPDATE_JOB_ID
  ) {
    await removeDashboardOperator(directory, state.mode);
  }
  // Older releases stored a mutable tag in config.env. The signed manifest
  // records its immutable digest, so rewrite only that reference before
  // Compose sees it; all other backup fields remain the authenticated data.
  await writeSecure(deploymentPaths(directory).env, serializeEnv(restoredEnv));
  await restoreManagedAssets(directory, backupPath, manifest);
  await restoreVolumeArchive(directory, state.mode, restoredEnv, backupPath);
  // Application startup can migrate an empty SQLite payload into a healthy
  // schema. Check the extracted snapshot while no application writes are
  // possible, so an invalid payload still follows safe pre-start recovery.
  const snapshotCheck = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only',
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
    '-v', `${state.volumeName}:/data`,
    '--env', `OR3_BASIC_AUTH_DB_PATH=${restoredEnv.OR3_BASIC_AUTH_DB_PATH ?? ''}`,
    '--env', `OR3_SQLITE_DB_PATH=${restoredEnv.OR3_SQLITE_DB_PATH ?? ''}`,
    '--env', `AUTH_PROVIDER=${restoredEnv.AUTH_PROVIDER ?? restoredEnv.OR3_AUTH_PROVIDER ?? 'basic-auth'}`,
    '--env', `NUXT_PUBLIC_STORAGE_PROVIDER=${restoredEnv.NUXT_PUBLIC_STORAGE_PROVIDER ?? 'fs'}`,
    '--env', `OR3_STORAGE_FS_ROOT=${restoredEnv.OR3_STORAGE_FS_ROOT ?? '/data/storage'}`,
    '--entrypoint', 'sh', restoredEnv.OR3_IMAGE,
    ...containerNodeCommand(VERIFY_RESTORED_DATA_SCRIPT).slice(1),
  ], directory);
  if (!snapshotCheck.ok) {
    throw new Error(`Restored snapshot integrity verification failed. ${redact(snapshotCheck.stderr, secretValues(restoredEnv))}`);
  }
  if (manifest.schemaVersion === 1) await restoreGenerationIdentities(directory, state, restoredEnv, backupPath, { previousSafetySnapshot: options.previousSafetySnapshot });
  // The caller journals the point at which application writes become possible
  // before requesting startup. Recovery snapshots keep their existing phase.
  await options.beforeStart?.();
  await startProject(directory, state.mode, restoredEnv);
  if (manifest.schemaVersion === 2 && manifest.remote.kind === 's3-copy-v1') {
    const result = await checkRemoteCopyTarget(directory, manifest, restoredEnv, backupPath, manifest.remote);
    if (result.missing || result.mismatched) throw new Error('S3 restore target has missing or mismatched objects after startup.');
  } else if (manifest.schemaVersion === 2 && manifest.remote.kind === 's3-reference-v1' && options.remoteReferencePolicy !== 'warn') {
    const result = await checkRemoteTarget(directory, manifest, restoredEnv, backupPath, manifest.remote);
    if (result.missing || result.mismatched) throw new Error('S3 reference target has missing or mismatched objects after startup.');
  }
  return manifest;
}

/**
 * Restores the verified snapshot taken immediately before a destructive
 * operation. Keeping this separate from the requested target prevents recovery
 * from "blessing" a partially restored target after an interruption.
 */
export async function restorePreMutationSnapshot(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
) {
  const pending = state.incompleteOperation;
  if (!pending) throw new Error('No incomplete operation is available to restore.');
  const previous = await recordedBackupPath(directory, pending);
  await updatePending(directory, state, { phase: 'restoring-previous' });
  if (pending.recreateDataVolume) {
    await restoreBackupData(directory, state, env, previous.path, { recreateDataVolume: true, previousSafetySnapshot: true, remoteReferencePolicy: 'warn' });
    return previous;
  }
  if (pending.previousRootOwnership) {
    await pullAndRequireImage(state.image, state.imageDigest, 'Previous deployment');
    await setManagedVolumeRootOwnership(directory, state, env, state.image, pending.previousRootOwnership);
  }
  await restoreBackupData(directory, state, env, previous.path, { previousSafetySnapshot: true, remoteReferencePolicy: 'warn' });
  return previous;
}
