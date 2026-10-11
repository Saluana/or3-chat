import { join } from 'node:path';
import {
  assertRestorableManagedAssets,
  MANAGED_ASSET_INVENTORY_VERSION,
  restoreManagedAssets,
} from '../deployment/assets';
import type { BackupManifest, ManagedState } from '../deployment/contracts';
import { dashboardUpdatesEnabled, parseEnv, secretValues, serializeEnv, withoutDashboardOperator } from '../deployment/env';
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

/** SQLite's 32-byte WAL header: https://sqlite.org/fileformat2.html#wal_file_format */
export function isValidSqliteWalHeader(header: Uint8Array) {
  if (header.byteLength !== 32) return false;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const magic = view.getUint32(0);
  const pageSize = view.getUint32(8);
  if ((magic !== 0x377f0682 && magic !== 0x377f0683) || view.getUint32(4) !== 3007000
    || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) return false;
  let first = 0;
  let second = 0;
  for (let offset = 0; offset < 24; offset += 8) {
    first = (first + view.getUint32(offset, magic === 0x377f0682) + second) >>> 0;
    second = (second + view.getUint32(offset + 4, magic === 0x377f0682) + first) >>> 0;
  }
  return first === view.getUint32(24) && second === view.getUint32(28);
}

/** Validate the duplicated native-order WAL-index header as a commit-boundary hint. */
export function readSqliteWalCommitBoundary(header: Uint8Array, byteLength: number, indexHeader?: Uint8Array) {
  if (!indexHeader || indexHeader.byteLength !== 96 || !isValidSqliteWalHeader(header)) return undefined;
  for (let offset = 0; offset < 48; offset++) if (indexHeader[offset] !== indexHeader[offset + 48]) return undefined;
  const index = new DataView(indexHeader.buffer, indexHeader.byteOffset, indexHeader.byteLength);
  const littleEndian = index.getUint32(0, true) === 3007000;
  if (!littleEndian && index.getUint32(0) !== 3007000) return undefined;
  const wal = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const encodedPageSize = index.getUint16(14, littleEndian);
  const pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
  if (index.getUint32(4, littleEndian) !== 0 || indexHeader[12] !== 1
    || indexHeader[13] !== Number(wal.getUint32(0) === 0x377f0683) || pageSize !== wal.getUint32(8)
    || index.getUint32(32) !== wal.getUint32(16) || index.getUint32(36) !== wal.getUint32(20)) return undefined;
  let first = 0;
  let second = 0;
  for (let offset = 0; offset < 40; offset += 8) {
    first = (first + index.getUint32(offset, littleEndian) + second) >>> 0;
    second = (second + index.getUint32(offset + 4, littleEndian) + first) >>> 0;
  }
  if (first !== index.getUint32(40, littleEndian) || second !== index.getUint32(44, littleEndian)) return undefined;
  const frameCount = index.getUint32(16, littleEndian);
  const databasePages = index.getUint32(20, littleEndian);
  if (!frameCount || !databasePages || frameCount > Math.floor((byteLength - 32) / (pageSize + 24))) return undefined;
  return { frameCount, databasePages, checksumFirst: index.getUint32(24, littleEndian), checksumSecond: index.getUint32(28, littleEndian) };
}

/** Stream WAL frames; only a verified commit boundary may authorize a discarded same-salt tail. */
export function assertValidSqliteWalFrames(
  header: Uint8Array,
  byteLength: number,
  readFrame: (offset: number, size: number) => Uint8Array,
  indexHeader?: Uint8Array,
) {
  if (!isValidSqliteWalHeader(header)) throw new Error('Invalid SQLite WAL header');
  if (!Number.isSafeInteger(byteLength) || byteLength < 32) throw new Error('Invalid SQLite WAL size');
  const wal = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const frameSize = wal.getUint32(8) + 24;
  const littleEndian = wal.getUint32(0) === 0x377f0682;
  let first = wal.getUint32(24);
  let second = wal.getUint32(28);
  let checkedFrames = 0;
  const boundary = readSqliteWalCommitBoundary(header, byteLength, indexHeader);
  let verifiedBoundary = false;
  let lastCommitFrame = 0;
  let discardedUncommittedTail = false;
  let offset = 32;
  let staleTail = false;
  for (; byteLength - offset >= frameSize; offset += frameSize) {
    const bytes = readFrame(offset, frameSize);
    if (bytes.byteLength !== frameSize) throw new Error('Could not read SQLite WAL frame');
    const frame = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (frame.getUint32(8) !== wal.getUint32(16) || frame.getUint32(12) !== wal.getUint32(20)) {
      staleTail = true;
      break;
    }
    for (let word = 0; word < frameSize; word += 8) {
      // Only the first eight header bytes and page content enter the checksum.
      if (word === 8) word = 24;
      first = (first + frame.getUint32(word, littleEndian) + second) >>> 0;
      second = (second + frame.getUint32(word + 4, littleEndian) + first) >>> 0;
    }
    if (first !== frame.getUint32(16) || second !== frame.getUint32(20)) {
      // A rollback can rewind the next append without truncating its old
      // uncommitted frames or changing salts. Never discard corruption within
      // the archived index's independently verified committed prefix.
      if (!boundary || !verifiedBoundary || lastCommitFrame !== boundary.frameCount) throw new Error('Invalid SQLite WAL frame checksum');
      for (let tailOffset = offset; byteLength - tailOffset >= frameSize; tailOffset += frameSize) {
        const tailBytes = readFrame(tailOffset, frameSize);
        if (tailBytes.byteLength !== frameSize) throw new Error('Could not read SQLite WAL frame');
        const tail = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);
        if (tail.getUint32(8) !== wal.getUint32(16) || tail.getUint32(12) !== wal.getUint32(20)) break;
        if (tail.getUint32(4) !== 0) throw new Error('Invalid SQLite WAL frame checksum');
      }
      discardedUncommittedTail = true;
      staleTail = true;
      break;
    }
    checkedFrames++;
    if (frame.getUint32(4) !== 0) lastCommitFrame = checkedFrames;
    if (boundary && checkedFrames === boundary.frameCount) {
      verifiedBoundary = frame.getUint32(4) === boundary.databasePages
        && first === boundary.checksumFirst && second === boundary.checksumSecond;
    }
  }
  // SQLite ignores an incomplete final frame after an interrupted append.
  return { checkedFrames, staleTail, discardedUncommittedTail, partialTailBytes: staleTail ? 0 : byteLength - offset };
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
const validWalHeader = ${isValidSqliteWalHeader.toString()};
const isValidSqliteWalHeader = validWalHeader;
const readSqliteWalCommitBoundary = ${readSqliteWalCommitBoundary.toString()};
const validWalFrames = ${assertValidSqliteWalFrames.toString()};
const validFilesystemPayload = ${assertFilesystemPayloadHash.toString()};
const paths = [process.env.OR3_BASIC_AUTH_DB_PATH, process.env.OR3_SQLITE_DB_PATH].filter(Boolean);
if (paths.length !== 2) throw new Error('Both managed database paths must be configured');
for (const path of paths) {
  const databasePath = fs.realpathSync(path);
  if (!fs.statSync(databasePath).isFile()) throw new Error('Restored database payload must be a regular file');
  const walPath = databasePath + '-wal';
  if (fs.existsSync(walPath)) {
    const info = fs.statSync(walPath);
    if (!info.isFile()) throw new Error('Restored WAL payload must be a regular file');
    if (info.size > 0) {
      const header = Buffer.alloc(32);
      const fd = fs.openSync(walPath, 'r');
      try {
        if (fs.readSync(fd, header, 0, 32, 0) !== 32 || !validWalHeader(header)) throw new Error('Invalid SQLite WAL header');
        const frame = Buffer.alloc(header.readUInt32BE(8) + 24);
        let indexHeader;
        const indexPath = databasePath + '-shm';
        if (fs.existsSync(indexPath)) {
          const indexInfo = fs.statSync(indexPath);
          if (indexInfo.isFile() && indexInfo.size >= 96 && indexInfo.size % 32768 === 0) {
            const indexFd = fs.openSync(indexPath, 'r');
            try {
              const bytes = Buffer.alloc(96);
              if (fs.readSync(indexFd, bytes, 0, 96, 0) === 96) indexHeader = bytes;
            } finally { fs.closeSync(indexFd); }
          }
        }
        validWalFrames(header, info.size, (offset, size) => {
          let read = 0;
          while (read < size) {
            const count = fs.readSync(fd, frame, read, size - read, offset + read);
            if (!count) break;
            read += count;
          }
          return frame.subarray(0, read);
        }, indexHeader);
      } finally { fs.closeSync(fd); }
    }
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
if ((storageRoot === '/data' || storageRoot.startsWith('/data/')) && fs.existsSync(workspacesRoot)) {
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
  options: { recreateDataVolume?: boolean; beforeStart?: () => Promise<void> } = {},
) {
  const manifest = await readManifest(backupPath, directory);
  assertRestorableManagedAssets(manifest);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, state, env);
  if (manifest.imageDigest) await requireImageDigest(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  await validateVolumeArchive(directory, state.mode, env, backupPath, backupEnv.OR3_STORAGE_FS_ROOT);
  await ensureManagedDataVolume(directory, state.mode, state, env);
  // Preflight the filesystem Docker will actually extract into. A compressed
  // tarball's byte size and the backup directory's filesystem cannot prove
  // there is room in /data.
  await assertRestoreFreeSpace(directory, state, env, manifest, backupPath);
  // An inventory older than v3 cannot safely re-enable the overlay: its
  // archived assets do not contain compose.operator.yaml. Treat it as a
  // CLI-only snapshot rather than leaving an orphaned Docker-socket sidecar.
  const restoresOperatorOverlay = manifest.managedAssetInventoryVersion === MANAGED_ASSET_INVENTORY_VERSION
    && Boolean(manifest.managedAssetSha256?.['compose.operator.yaml']);
  const restoredEnv = restoresOperatorOverlay
    ? {
        ...backupEnv,
        OR3_IMAGE: imageAtDigest(manifest.image, manifest.imageDigest),
      }
    : withoutDashboardOperator({
        ...backupEnv,
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
    '--env', `OR3_STORAGE_FS_ROOT=${restoredEnv.OR3_STORAGE_FS_ROOT ?? '/data/storage'}`,
    '--entrypoint', 'sh', restoredEnv.OR3_IMAGE,
    ...containerNodeCommand(VERIFY_RESTORED_DATA_SCRIPT).slice(1),
  ], directory);
  if (!snapshotCheck.ok) {
    throw new Error(`Restored snapshot integrity verification failed. ${redact(snapshotCheck.stderr, secretValues(restoredEnv))}`);
  }
  // The caller journals the point at which application writes become possible
  // before requesting startup. Recovery snapshots keep their existing phase.
  await options.beforeStart?.();
  await startProject(directory, state.mode, restoredEnv);
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
    await restoreBackupData(directory, state, env, previous.path, { recreateDataVolume: true });
    return previous;
  }
  if (pending.previousRootOwnership) {
    await pullAndRequireImage(state.image, state.imageDigest, 'Previous deployment');
    await setManagedVolumeRootOwnership(directory, state, env, state.image, pending.previousRootOwnership);
  }
  await restoreBackupData(directory, state, env, previous.path);
  return previous;
}
