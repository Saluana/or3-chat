import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupManifest, ManagedState, RemoteSnapshot, RemoteSource } from '../deployment/contracts';
import { secretValues } from '../deployment/env';
import { imageAtDigest } from '../deployment/identity';
import { deploymentPaths } from '../deployment/paths';
import { sha256File } from '../util/fs';
import { redact } from '../util/primitives';
import { assertFreeSpaceForArchive } from './archive';
import { withBackupHelper } from './helper';

const INSPECTOR = '/app/scripts/docker/backup-inspect.mjs';
const REMOTE = '/app/scripts/docker/remote-objects.mjs';
const NODE = 'if [ -x /nodejs/bin/node ]; then exec /nodejs/bin/node "$@"; else exec node "$@"; fi';
const INPUT_NODE = 'if [ -x /nodejs/bin/node ]; then exec /nodejs/bin/node "$@" < /or3-backup.tar; else exec node "$@" < /or3-backup.tar; fi';
const SOURCE_ENV = ['OR3_STORAGE_S3_ENDPOINT', 'OR3_STORAGE_S3_REGION', 'OR3_STORAGE_S3_BUCKET', 'OR3_STORAGE_S3_KEY_PREFIX', 'OR3_STORAGE_S3_ALLOW_INSECURE_HTTP'] as const;
const TRANSFER_ENV = [...SOURCE_ENV, 'OR3_STORAGE_S3_ACCESS_KEY_ID', 'OR3_STORAGE_S3_SECRET_ACCESS_KEY', 'OR3_STORAGE_S3_SESSION_TOKEN', 'OR3_STORAGE_S3_FORCE_PATH_STYLE'] as const;

/** The saved identity contains no credentials and cannot collapse endpoint paths. */
export function remoteSource(env: Record<string, string>): RemoteSource {
  if (env.OR3_SYNC_PROVIDER !== 'sqlite' || env.NUXT_PUBLIC_STORAGE_PROVIDER !== 's3' || env.OR3_SQLITE_DRIVER && env.OR3_SQLITE_DRIVER !== 'better-sqlite3') throw new Error('Unsupported offline S3 backup provider profile.');
  let endpoint: URL;
  try { endpoint = new URL((env.OR3_STORAGE_S3_ENDPOINT ?? '').trim()); } catch { throw new Error('Invalid S3 recovery configuration.'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.protocol === 'http:' && env.OR3_STORAGE_S3_ALLOW_INSECURE_HTTP !== 'true') throw new Error('Invalid S3 recovery configuration.');
  const bucket = (env.OR3_STORAGE_S3_BUCKET ?? '').trim();
  const prefix = (env.OR3_STORAGE_S3_KEY_PREFIX ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!bucket || bucket.length > 255 || /[\x00-\x20\x7f/\\]/.test(bucket) || prefix.length > 511 || /[\x00-\x1f\\]/.test(prefix) || prefix && prefix.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid S3 recovery configuration.');
  return { endpointOrigin: endpoint.origin, bucket, keyPrefix: prefix ? `${prefix}/` : '' };
}

export function assertRemoteTransferConfiguration(env: Record<string, string>) {
  const source = remoteSource(env);
  if (!env.OR3_STORAGE_S3_REGION?.trim() || !env.OR3_STORAGE_S3_ACCESS_KEY_ID?.trim() || !env.OR3_STORAGE_S3_SECRET_ACCESS_KEY?.trim()) throw new Error('Invalid S3 recovery configuration.');
  return source;
}

type Summary = { contract: 2; references: number; payloadBytes: number };
type Verified = { contract: 2; kind: 's3-copy-v1'; objectCount: number; payloadBytes: number; inventorySha256: string };
type CopySnapshot = Extract<RemoteSnapshot, { kind: 's3-copy-v1' }>;
type ReferenceSnapshot = Extract<RemoteSnapshot, { kind: 's3-reference-v1' }>;
type ImageIdentity = Pick<ManagedState, 'image' | 'imageDigest'>;

/** The caller must supply a manifest already authenticated for this deployment. */
export async function preflightRemoteRestore(directory: string, manifest: Extract<BackupManifest, { schemaVersion: 2 }>, target: Record<string, string>, backupDir: string) {
  if (manifest.remote.kind === 's3-copy-v1') {
    try { return await reconcileRemoteTarget(directory, manifest, target, backupDir, manifest.remote); }
    catch (error) {
      const detail = redact(error instanceof Error ? error.message : String(error), secretValues(target));
      throw new Error(`S3 reconciliation did not complete; additive objects may remain in the target. ${detail}`, { cause: error });
    }
  }
  const result = await checkRemoteTarget(directory, manifest, target, backupDir, manifest.remote);
  if (result.missing || result.mismatched) throw new Error('S3 reference target has missing or mismatched objects.');
  return result;
}

function checkedCounts(result: { checked: number; missing: unknown[]; mismatched: unknown[] }, expected: number) {
  if (result.checked !== expected || !Array.isArray(result.missing) || !Array.isArray(result.mismatched) || result.missing.length + result.mismatched.length > result.checked || [...result.missing, ...result.mismatched].some(value => typeof value !== 'string' || value.length > 1024)) throw new Error('Invalid S3 reference check receipt.');
  return { checked: result.checked, missing: result.missing.length, mismatched: result.mismatched.length };
}

function sourceEnvironment(source: RemoteSource): Record<string, string> {
  const env = { OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: source.endpointOrigin, OR3_STORAGE_S3_BUCKET: source.bucket, OR3_STORAGE_S3_KEY_PREFIX: source.keyPrefix, OR3_STORAGE_S3_ALLOW_INSECURE_HTTP: source.endpointOrigin.startsWith('http:') ? 'true' : 'false' };
  const normalized = remoteSource(env);
  if (normalized.endpointOrigin !== source.endpointOrigin || normalized.bucket !== source.bucket || normalized.keyPrefix !== source.keyPrefix) throw new Error('Invalid S3 backup source.');
  return env;
}

async function assertArchive(backupDir: string, remote: CopySnapshot) {
  if (remote.kind !== 's3-copy-v1' || remote.file !== 'remote-objects.tar' || !/^[a-f0-9]{64}$/.test(remote.sha256) || !Number.isSafeInteger(remote.bytes) || remote.bytes < 1) throw new Error('Invalid S3 backup archive metadata.');
  const archive = join(backupDir, remote.file);
  if ((await stat(archive)).size !== remote.bytes || await sha256File(archive) !== remote.sha256) throw new Error('S3 backup archive checksum or size mismatch.');
  return archive;
}

/** Call only with remote metadata read from an authenticated manifest. */
export async function verifyRemoteSnapshot(directory: string, image: ImageIdentity, backupDir: string, remote: CopySnapshot) {
  const env = sourceEnvironment(remote.source);
  const archive = await assertArchive(backupDir, remote);
  const receipt = join(deploymentPaths(directory).operations, `.s3-verify-${randomUUID()}.json`);
  let verified: Verified;
  try {
    verified = await withBackupHelper(directory, imageAtDigest(image.image, image.imageDigest), env, { network: 'none', passEnv: SOURCE_ENV, archiveFile: archive, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(join(backupDir, 'data.tgz'));
      await helper.execToFile(['sh', '-c', INPUT_NODE, 'or3-s3-verify', REMOTE, 'verify', '/scratch/sync.sqlite'], receipt);
      if ((await stat(receipt)).size > 64 * 1024) throw new Error('Invalid S3 backup verification receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as Verified;
    });
  } finally { await rm(receipt, { force: true }); }
  if (verified.contract !== 2 || verified.kind !== 's3-copy-v1' || verified.objectCount !== remote.objectCount || verified.payloadBytes !== remote.payloadBytes || verified.inventorySha256 !== remote.inventorySha256) throw new Error('S3 backup verification did not match the authenticated manifest.');
  await assertArchive(backupDir, remote);
}

/** Additive only; this also verifies offline before starting a network helper. */
export async function reconcileRemoteTarget(directory: string, image: ImageIdentity, target: Record<string, string>, backupDir: string, remote: CopySnapshot) {
  const destination = assertRemoteTransferConfiguration(target);
  if (destination.keyPrefix !== remote.source.keyPrefix) throw new Error('S3 backup and target key prefix mismatch.');
  await verifyRemoteSnapshot(directory, image, backupDir, remote);
  const archive = await assertArchive(backupDir, remote);
  const env = { ...target, OR3_BACKUP_S3_ENDPOINT_ORIGIN: remote.source.endpointOrigin, OR3_BACKUP_S3_BUCKET: remote.source.bucket, OR3_BACKUP_S3_KEY_PREFIX: remote.source.keyPrefix, OR3_BACKUP_ARCHIVE_SHA256: remote.sha256 };
  const receipt = join(deploymentPaths(directory).operations, `.s3-reconcile-${randomUUID()}.json`);
  let result: { uploaded: number; markersCreated: number };
  try {
    result = await withBackupHelper(directory, imageAtDigest(image.image, image.imageDigest), env, { network: 'egress', passEnv: [...TRANSFER_ENV, 'OR3_BACKUP_S3_ENDPOINT_ORIGIN', 'OR3_BACKUP_S3_BUCKET', 'OR3_BACKUP_S3_KEY_PREFIX', 'OR3_BACKUP_ARCHIVE_SHA256'], archiveFile: archive, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(join(backupDir, 'data.tgz'));
      await helper.execToFile(['sh', '-c', NODE, 'or3-s3-reconcile', REMOTE, 'reconcile', '/scratch/sync.sqlite', '/or3-backup.tar'], receipt);
      if ((await stat(receipt)).size > 64 * 1024) throw new Error('Invalid S3 reconciliation receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as { uploaded: number; markersCreated: number };
    });
  } finally { await rm(receipt, { force: true }); }
  if (!Number.isSafeInteger(result.uploaded) || result.uploaded < 0 || result.uploaded > remote.objectCount || !Number.isSafeInteger(result.markersCreated) || result.markersCreated < 0 || result.markersCreated > remote.objectCount) throw new Error('Invalid S3 reconciliation receipt.');
  return { uploaded: result.uploaded, markersCreated: result.markersCreated };
}

/** Recheck a copied snapshot's objects after startup, without modifying the target. */
export async function checkRemoteCopyTarget(directory: string, image: ImageIdentity, target: Record<string, string>, backupDir: string, remote: CopySnapshot) {
  const destination = assertRemoteTransferConfiguration(target);
  if (destination.keyPrefix !== remote.source.keyPrefix) throw new Error('S3 backup and target key prefix mismatch.');
  await verifyRemoteSnapshot(directory, image, backupDir, remote);
  const archive = await assertArchive(backupDir, remote);
  const env = { ...target, OR3_BACKUP_S3_ENDPOINT_ORIGIN: remote.source.endpointOrigin, OR3_BACKUP_S3_BUCKET: remote.source.bucket, OR3_BACKUP_S3_KEY_PREFIX: remote.source.keyPrefix, OR3_BACKUP_ARCHIVE_SHA256: remote.sha256 };
  const receipt = join(deploymentPaths(directory).operations, `.s3-check-copy-${randomUUID()}.json`);
  try {
    const result = await withBackupHelper(directory, imageAtDigest(image.image, image.imageDigest), env, { network: 'egress', passEnv: [...TRANSFER_ENV, 'OR3_BACKUP_S3_ENDPOINT_ORIGIN', 'OR3_BACKUP_S3_BUCKET', 'OR3_BACKUP_S3_KEY_PREFIX', 'OR3_BACKUP_ARCHIVE_SHA256'], archiveFile: archive, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(join(backupDir, 'data.tgz'));
      await helper.execToFile(['sh', '-c', NODE, 'or3-s3-check-copy', REMOTE, 'check-copy', '/scratch/sync.sqlite', '/or3-backup.tar'], receipt);
      if ((await stat(receipt)).size > 64 * 1024 * 1024) throw new Error('Invalid S3 reference check receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as { checked: number; missing: unknown[]; mismatched: unknown[] };
    });
    return checkedCounts(result, remote.objectCount);
  } finally { await rm(receipt, { force: true }); }
}

/** Read-only checks for authenticated reference-only rollback snapshots. */
export async function checkRemoteTarget(directory: string, image: ImageIdentity, target: Record<string, string>, backupDir: string, remote: ReferenceSnapshot) {
  const source = assertRemoteTransferConfiguration(target);
  if (source.endpointOrigin !== remote.source.endpointOrigin || source.bucket !== remote.source.bucket || source.keyPrefix !== remote.source.keyPrefix) throw new Error('S3 reference snapshot can only use its original source target.');
  if (remote.kind !== 's3-reference-v1' || remote.file !== 'remote-inventory.json' || !/^[a-f0-9]{64}$/.test(remote.sha256) || remote.inventorySha256 !== remote.sha256 || !Number.isSafeInteger(remote.bytes) || remote.bytes < 1 || remote.bytes > 64 * 1024 * 1024) throw new Error('Invalid S3 backup reference inventory.');
  const inventory = join(backupDir, remote.file);
  const assertInventory = async () => { if ((await stat(inventory)).size !== remote.bytes || await sha256File(inventory) !== remote.sha256) throw new Error('S3 backup inventory checksum or size mismatch.'); };
  await assertInventory();
  const offlineEnv = sourceEnvironment(remote.source);
  const receipt = join(deploymentPaths(directory).operations, `.s3-check-${randomUUID()}.json`);
  try {
    const verified = await withBackupHelper(directory, imageAtDigest(image.image, image.imageDigest), offlineEnv, { network: 'none', passEnv: SOURCE_ENV, archiveFile: inventory, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(join(backupDir, 'data.tgz'));
      await helper.execToFile(['sh', '-c', INPUT_NODE, 'or3-s3-verify-inventory', REMOTE, 'verify-inventory', '/scratch/sync.sqlite'], receipt);
      if ((await stat(receipt)).size > 64 * 1024) throw new Error('Invalid S3 backup verification receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as Omit<Verified, 'kind'> & { kind: 's3-reference-v1' };
    });
    if (verified.contract !== 2 || verified.kind !== 's3-reference-v1' || verified.objectCount !== remote.objectCount || verified.payloadBytes !== remote.payloadBytes || verified.inventorySha256 !== remote.inventorySha256) throw new Error('S3 inventory verification did not match the authenticated manifest.');
    await rm(receipt, { force: true });
    await assertInventory();
    const result = await withBackupHelper(directory, imageAtDigest(image.image, image.imageDigest), target, { network: 'egress', passEnv: TRANSFER_ENV, archiveFile: inventory, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(join(backupDir, 'data.tgz'));
      await helper.execToFile(['sh', '-c', INPUT_NODE, 'or3-s3-check', REMOTE, 'check', '/scratch/sync.sqlite'], receipt);
      if ((await stat(receipt)).size > 64 * 1024 * 1024) throw new Error('Invalid S3 reference check receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as { checked: number; missing: unknown[]; mismatched: unknown[] };
    });
    return checkedCounts(result, remote.objectCount);
  } finally { await rm(receipt, { force: true }); }
}

function assertSummary(summary: Summary) {
  if (summary.contract !== 2 || !Number.isSafeInteger(summary.references) || summary.references < 0 || summary.references > 100_000 || !Number.isSafeInteger(summary.payloadBytes) || summary.payloadBytes < 0 || summary.payloadBytes > summary.references * 2 ** 30) throw new Error('Invalid S3 backup reference summary.');
}

/** A local rollback inventory describes references; it is not a recovery copy. */
export async function captureRemoteInventory(directory: string, state: ManagedState, env: Record<string, string>, backupDir: string): Promise<RemoteSnapshot> {
  const source = remoteSource(env);
  const image = imageAtDigest(state.image, state.imageDigest);
  const data = join(backupDir, 'data.tgz');
  const inventory = join(backupDir, 'remote-inventory.json');
  const summary = await withBackupHelper(directory, image, env, { network: 'none', passEnv: SOURCE_ENV, lifetimeSeconds: 14_400 }, async helper => {
    await helper.loadSqlite(data);
    const result = JSON.parse(await helper.exec(['sh', '-c', NODE, 'or3-s3-summary', INSPECTOR, 's3-summary', source.keyPrefix])) as Summary;
    assertSummary(result);
    await helper.execToFile(['sh', '-c', NODE, 'or3-s3-inventory', REMOTE, 'inventory', '/scratch/sync.sqlite'], inventory);
    return result;
  });
  const bytes = (await stat(inventory)).size;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 64 * 1024 * 1024) throw new Error('Invalid S3 backup reference inventory.');
  const before = await sha256File(inventory);
  const receipt = join(backupDir, `.s3-inventory-verification-${randomUUID()}.json`);
  let verified: Omit<Verified, 'kind'> & { kind: 's3-reference-v1' };
  try {
    verified = await withBackupHelper(directory, image, env, { network: 'none', passEnv: SOURCE_ENV, archiveFile: inventory, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(data);
      await helper.execToFile(['sh', '-c', INPUT_NODE, 'or3-s3-verify-inventory', REMOTE, 'verify-inventory', '/scratch/sync.sqlite'], receipt);
      if ((await stat(receipt)).size > 64 * 1024) throw new Error('Invalid S3 backup verification receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as Omit<Verified, 'kind'> & { kind: 's3-reference-v1' };
    });
  } finally { await rm(receipt, { force: true }); }
  if (verified.contract !== 2 || verified.kind !== 's3-reference-v1' || verified.objectCount !== summary.references || verified.payloadBytes !== summary.payloadBytes || verified.inventorySha256 !== before) throw new Error('S3 backup verification did not match the canonical reference summary.');
  if (await sha256File(inventory) !== before || (await stat(inventory)).size !== bytes) throw new Error('S3 backup inventory changed during verification.');
  return { kind: 's3-reference-v1', file: 'remote-inventory.json', sha256: before, bytes, inventorySha256: verified.inventorySha256, objectCount: verified.objectCount, payloadBytes: verified.payloadBytes, source, providerVersion: '0.0.15' };
}

export async function captureRemoteSnapshot(directory: string, state: ManagedState, env: Record<string, string>, backupDir: string): Promise<RemoteSnapshot> {
  const source = assertRemoteTransferConfiguration(env);
  const image = imageAtDigest(state.image, state.imageDigest);
  const data = join(backupDir, 'data.tgz');
  const archive = join(backupDir, 'remote-objects.tar');
  const summary = await withBackupHelper(directory, image, env, { network: 'none', passEnv: SOURCE_ENV }, async helper => {
    await helper.loadSqlite(data);
    return JSON.parse(await helper.exec(['sh', '-c', NODE, 'or3-s3-summary', INSPECTOR, 's3-summary', source.keyPrefix])) as Summary;
  });
  assertSummary(summary);
  // Account for the worst permitted marker, tar framing and inventory entry.
  const required = summary.payloadBytes + summary.references * (64 * 1024 + 4096) + 64 * 1024 * 1024;
  await assertFreeSpaceForArchive(archive, required, 'S3 backup');
  await withBackupHelper(directory, image, env, { network: 'egress', passEnv: TRANSFER_ENV }, async helper => {
    await helper.loadSqlite(data);
    await helper.execToFile(['sh', '-c', NODE, 'or3-s3-capture', REMOTE, 'capture', '/scratch/sync.sqlite'], archive);
  });
  const before = await sha256File(archive);
  const receipt = join(backupDir, `.s3-verification-${randomUUID()}.json`);
  let verified: Verified;
  try {
    verified = await withBackupHelper(directory, image, env, { network: 'none', passEnv: SOURCE_ENV, archiveFile: archive, lifetimeSeconds: 14_400 }, async helper => {
      await helper.loadSqlite(data);
      await helper.execToFile(['sh', '-c', INPUT_NODE, 'or3-s3-verify', REMOTE, 'verify', '/scratch/sync.sqlite'], receipt);
      const size = (await stat(receipt)).size;
      if (size > 64 * 1024) throw new Error('Invalid S3 backup verification receipt.');
      return JSON.parse(await readFile(receipt, 'utf8')) as Verified;
    });
  } finally {
    await rm(receipt, { force: true });
  }
  if (verified.contract !== 2 || verified.kind !== 's3-copy-v1' || verified.objectCount !== summary.references || verified.payloadBytes !== summary.payloadBytes || !/^[a-f0-9]{64}$/.test(verified.inventorySha256)) throw new Error('S3 backup verification did not match the canonical reference summary.');
  const bytes = (await stat(archive)).size;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || await sha256File(archive) !== before) throw new Error('S3 backup archive changed during verification.');
  return { kind: 's3-copy-v1', file: 'remote-objects.tar', sha256: before, bytes, inventorySha256: verified.inventorySha256, objectCount: verified.objectCount, payloadBytes: verified.payloadBytes, source, providerVersion: '0.0.15' };
}
