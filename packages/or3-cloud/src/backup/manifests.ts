import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { verifiedManagedAssetContents } from '../deployment/assets';
import type {
  BackupEntry,
  BackupInventory,
  BackupListing,
  BackupManifest,
  ManagedState,
  PendingOperation,
} from '../deployment/contracts';
import { assertDeploymentIdentity, DEPLOYMENT_ENV_KEYS, isVersion } from '../deployment/identity';
import { backupDirectory, deploymentPaths } from '../deployment/paths';
import { lifecycleFaults } from '../lifecycle-faults';
import { fileExists, readText, sha256File, writeSecure } from '../util/fs';

export const BACKUP_ID_PATTERN = /^backup-[0-9A-Za-z-]+$/;

async function backupAuthenticationKey(directory: string, create = false) {
  const keyPath = deploymentPaths(directory).backupAuthKey;
  try {
    const key = (await readText(keyPath)).trim();
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('invalid format');
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Backup authentication key at ${keyPath} is invalid or unreadable. Restore is refused until it is repaired from the deployment owner’s secure key material.`);
    }
    if (!create) {
      throw new Error(`This deployment has no backup authentication key at ${keyPath}. Backups created by older CLI versions are intentionally not trusted for restore. Create a new verified backup before attempting a destructive restore.`);
    }
    const key = randomBytes(32).toString('hex');
    await writeSecure(keyPath, `${key}\n`);
    return key;
  }
}

function backupAuthenticationTag(key: string, manifestContents: string) {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(manifestContents).digest('hex');
}

export async function writeBackupAuthentication(directory: string, backupPath: string, manifestContents: string) {
  const key = await backupAuthenticationKey(directory, true);
  await writeSecure(join(backupPath, 'manifest.auth'), `${backupAuthenticationTag(key, manifestContents)}\n`);
}

async function assertBackupAuthentication(directory: string, backupPath: string, manifestContents: string) {
  const key = await backupAuthenticationKey(directory);
  let provided: Buffer;
  try {
    const value = (await readText(join(backupPath, 'manifest.auth'))).trim();
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('invalid authentication tag');
    provided = Buffer.from(value, 'hex');
  } catch {
    throw new Error(`Backup at ${backupPath} has no valid deployment authentication tag. Refusing to restore or export an unauthenticated backup.`);
  }
  const expected = Buffer.from(backupAuthenticationTag(key, manifestContents), 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error(`Backup authentication failed for ${backupPath}. Refusing to trust data, configuration, or managed assets from another deployment.`);
  }
}

function classifyBackupError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication failed|no valid deployment authentication tag|invalid authentication tag/i.test(message)) {
    return { code: 'backup-authentication-failed', message };
  }
  if (/checksum mismatch/i.test(message)) return { code: 'backup-checksum-mismatch', message };
  if (/invalid managed asset inventory|managed asset checksum mismatch/i.test(message)) {
    return { code: 'backup-assets-invalid', message };
  }
  if (/Invalid backup manifest/i.test(message)) return { code: 'backup-manifest-invalid', message };
  if ((error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOENT') return { code: 'backup-entry-incomplete', message };
  return { code: 'backup-entry-invalid', message };
}

type BackupEntryInspection = BackupEntry;

/**
 * Classifies one direct backup-store entry. Uses `lstat` so a symlink is never
 * followed; metadata reads are bounded to the six expected files. Missing
 * authentication is legacy (preserved), while unreadable/malformed/invalid
 * authentication is reported as invalid rather than aborting the scan.
 */
export async function inspectBackupEntry(backupsRoot: string, entry: string, directory: string): Promise<BackupEntryInspection> {
  const path = join(backupsRoot, entry);
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    return { kind: 'unreadable', entryName: entry, ...classifyBackupError(error) };
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    return {
      kind: 'invalid',
      entryName: entry,
      code: 'backup-entry-not-directory',
      message: `Backup store entry ${entry} is not a regular directory; symlinks and non-directories are never trusted.`,
    };
  }
  // Older adopters stored source archives outside the authenticated format.
  if (/^adopt-source-[0-9A-Za-z-]+$/.test(entry)) {
    return {
      kind: 'legacy-adoption',
      entryName: entry,
      code: 'backup-legacy-adoption',
      message: `Preserved legacy adoption source ${entry}; it is not an authenticated managed backup.`,
    };
  }
  if (!BACKUP_ID_PATTERN.test(entry)) {
    return {
      kind: 'invalid',
      entryName: entry,
      code: 'backup-entry-unexpected',
      message: `Backup store contains an unexpected artifact ${path}; inspect or remove it explicitly.`,
    };
  }
  try {
    await lstat(join(path, 'manifest.auth'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        kind: 'legacy-unsigned',
        entryName: entry,
        code: 'backup-unsigned',
        message: `Preserved unauthenticated backup ${entry} (no manifest.auth); never trusted for restore.`,
      };
    }
    return { kind: 'unreadable', entryName: entry, ...classifyBackupError(error) };
  }
  try {
    const raw = JSON.parse(await readText(join(path, 'manifest.json'))) as { schemaVersion?: unknown };
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > 1) {
      return {
        kind: 'unsupported',
        entryName: entry,
        code: 'backup-format-unsupported',
        message: `Backup ${entry} uses manifest schema ${raw.schemaVersion}; preserved for a newer reader.`,
      };
    }
  } catch (error) {
    return { kind: 'invalid', entryName: entry, ...classifyBackupError(error) };
  }
  try {
    const manifest = await readManifest(path, directory);
    if (manifest.backupId !== entry) {
      return {
        kind: 'invalid',
        entryName: entry,
        code: 'backup-id-mismatch',
        message: `Backup directory ${path} does not match manifest ID ${manifest.backupId}.`,
      };
    }
    if (!Number.isFinite(Date.parse(manifest.createdAt))) {
      return {
        kind: 'invalid',
        entryName: entry,
        code: 'backup-created-at-invalid',
        message: `Backup ${manifest.backupId} has an invalid creation time.`,
      };
    }
    let bytes = 0;
    for (const file of ['data.tgz', 'config.env', 'manifest.json', 'manifest.auth']) {
      bytes += (await lstat(join(path, file))).size;
    }
    return {
      kind: 'verified',
      backup: {
        backupId: manifest.backupId,
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        path,
        bytes,
        dataSha256: manifest.dataSha256,
      },
    };
  } catch (error) {
    return { kind: 'invalid', entryName: entry, ...classifyBackupError(error) };
  }
}

const BACKUP_ENTRY_SEVERITY: Record<BackupEntry['kind'], number> = {
  verified: 0,
  'legacy-unsigned': 1,
  'legacy-adoption': 2,
  unsupported: 3,
  invalid: 4,
  unreadable: 5,
};

/**
 * Observations of the whole backup store: one classification per direct entry,
 * in deterministic severity/name order, plus any store-level diagnostic. It is
 * never authority to restore or delete; authentication still gates trust.
 */
export async function inventoryBackups(directory: string): Promise<BackupInventory> {
  const backupsRoot = deploymentPaths(directory).backups;
  let names: string[];
  try {
    names = await readdir(backupsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], storeErrors: [] };
    return {
      entries: [],
      storeErrors: [{
        code: 'backup-store-unreadable',
        severity: 'blocker',
        resource: backupsRoot,
        message: `Could not enumerate managed backups at ${backupsRoot}: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
  const entries: BackupEntry[] = [];
  for (const name of [...names].sort()) entries.push(await inspectBackupEntry(backupsRoot, name, directory));
  entries.sort((a, b) => {
    const severity = BACKUP_ENTRY_SEVERITY[a.kind] - BACKUP_ENTRY_SEVERITY[b.kind];
    if (severity !== 0) return severity;
    const aName = a.kind === 'verified' ? a.backup.backupId : a.entryName;
    const bName = b.kind === 'verified' ? b.backup.backupId : b.entryName;
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  });
  return { entries, storeErrors: [] };
}

/** Enumerates only fully verified backups (newest first) for restore/listing. */
export async function enumerateBackups(directory: string): Promise<BackupListing[]> {
  const inventory = await inventoryBackups(directory);
  return inventory.entries
    .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
    .map((entry) => entry.backup)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function assertBackupMatchesDeployment(manifest: Partial<BackupManifest>, backupEnv: Record<string, string>, state: ManagedState, env: Record<string, string>) {
  if (manifest.mode !== state.mode || manifest.appVersion === undefined || manifest.image === undefined) {
    throw new Error(`Backup ${manifest.backupId} does not match the managed deployment mode.`);
  }
  assertDeploymentIdentity(state, env);
  const expected: Record<string, string | undefined> = {
    OR3_COMPOSE_PROJECT: state.composeProject,
    OR3_VOLUME_NAME: state.volumeName,
    OR3_CADDY_DATA_VOLUME: state.caddyDataVolume,
    OR3_CADDY_CONFIG_VOLUME: state.caddyConfigVolume,
    OR3_PORT: String(state.port),
    OR3_PUBLIC_DOMAIN: state.domain ?? 'localhost',
  };
  for (const key of DEPLOYMENT_ENV_KEYS) {
    if (state.mode === 'local' && (key === 'OR3_CADDY_DATA_VOLUME' || key === 'OR3_CADDY_CONFIG_VOLUME')) continue;
    if (backupEnv[key] !== expected[key]) {
      throw new Error(`Backup ${manifest.backupId} belongs to a different deployment identity (${key}). Refusing to replace this deployment's data.`);
    }
  }
  if (manifest.composeProject !== undefined && manifest.composeProject !== state.composeProject) {
    throw new Error(`Backup ${manifest.backupId} belongs to Compose project ${manifest.composeProject}, not ${state.composeProject}.`);
  }
  if (manifest.volumeName !== undefined && manifest.volumeName !== state.volumeName) {
    throw new Error(`Backup ${manifest.backupId} belongs to volume ${manifest.volumeName}, not ${state.volumeName}.`);
  }
  if (manifest.domain !== undefined && manifest.domain !== state.domain) {
    throw new Error(`Backup ${manifest.backupId} belongs to domain ${manifest.domain}, not ${state.domain ?? 'localhost'}.`);
  }
  if (manifest.caddyDataVolume !== undefined && manifest.caddyDataVolume !== state.caddyDataVolume) {
    throw new Error(`Backup ${manifest.backupId} belongs to a different Caddy data volume.`);
  }
  if (manifest.caddyConfigVolume !== undefined && manifest.caddyConfigVolume !== state.caddyConfigVolume) {
    throw new Error(`Backup ${manifest.backupId} belongs to a different Caddy config volume.`);
  }
  if (state.deploymentId && (manifest.deploymentId !== state.deploymentId || backupEnv.OR3_DEPLOYMENT_ID !== state.deploymentId)) {
    // The first identity-aware update may retain one authenticated pre-update
    // snapshot whose older assets have no deployment label. It is safe to use
    // only for the same Compose/volume identity checked above; any supplied
    // conflicting identity remains a hard refusal.
    const legacySnapshot = manifest.deploymentId === undefined && backupEnv.OR3_DEPLOYMENT_ID === undefined;
    if (!legacySnapshot) {
      throw new Error(`Backup ${manifest.backupId} belongs to a different immutable deployment identity.`);
    }
  }
  if (manifest.port !== undefined && manifest.port !== state.port) {
    throw new Error(`Backup ${manifest.backupId} belongs to port ${manifest.port}, not ${state.port}.`);
  }
}

export async function readManifest(backupPath: string, authenticatedForDirectory?: string) {
  await lifecycleFaults.beforeArchiveRead?.();
  const manifestContents = await readText(join(backupPath, 'manifest.json'));
  if (authenticatedForDirectory) await assertBackupAuthentication(authenticatedForDirectory, backupPath, manifestContents);
  const manifest = JSON.parse(manifestContents) as BackupManifest;
  if (
    (manifest.schemaVersion as unknown) !== 1 ||
    !BACKUP_ID_PATTERN.test(manifest.backupId) ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !isVersion(manifest.appVersion) ||
    !manifest.image ||
    !/^sha256:[0-9a-f]{64}$/i.test(manifest.imageDigest) ||
    !/^[0-9a-f]{64}$/i.test(manifest.dataSha256) ||
    !/^[0-9a-f]{64}$/i.test(manifest.configSha256 ?? '') ||
    (manifest.dataBytes !== undefined && (!Number.isSafeInteger(manifest.dataBytes) || manifest.dataBytes < 0))
  ) {
    throw new Error(`Invalid backup manifest at ${backupPath}.`);
  }
  const actual = await sha256File(join(backupPath, 'data.tgz'));
  if (actual !== manifest.dataSha256) throw new Error(`Backup checksum mismatch for ${manifest.backupId}. Expected ${manifest.dataSha256}, got ${actual}.`);
  if (manifest.configSha256) {
    const configActual = await sha256File(join(backupPath, 'config.env'));
    if (configActual !== manifest.configSha256) throw new Error(`Backup configuration checksum mismatch for ${manifest.backupId}.`);
  }
  await verifiedManagedAssetContents(backupPath, manifest);
  return manifest;
}

export async function resolveBackup(directory: string, value: string) {
  if (!isAbsolute(value) && !BACKUP_ID_PATTERN.test(value)) {
    throw new Error(`Backup ID "${value}" is invalid. Use an OR3-generated backup ID or an absolute external backup path.`);
  }
  const candidate = isAbsolute(value) ? value : backupDirectory(directory, value);
  if (!await fileExists(join(candidate, 'manifest.json'))) throw new Error(`Backup ${value} was not found in ${deploymentPaths(directory).backups}.`);
  return resolve(candidate);
}

export async function recordedBackupPath(directory: string, pending: PendingOperation) {
  // Updates have one pre-update backup. Restore/rollback have a requested
  // target backup plus a separate snapshot of the deployment being replaced.
  const previous = pending.operation !== 'update';
  const path = previous ? pending.previousBackupPath : pending.backupPath;
  const backupId = previous ? pending.previousBackupId : pending.backupId;
  const resolved = path
    ? resolve(path)
    : backupId
      ? await resolveBackup(directory, backupId)
      : undefined;
  if (!resolved || !await fileExists(join(resolved, 'manifest.json'))) {
    throw new Error(`The incomplete ${pending.operation} has no readable ${previous ? 'pre-mutation' : 'target'} backup source.`);
  }
  const manifest = await readManifest(resolved, directory);
  if (!previous) {
    if (pending.backupDataSha256 && pending.backupDataSha256 !== manifest.dataSha256) {
      throw new Error(`The recorded target backup at ${resolved} no longer has its expected data checksum.`);
    }
    if (pending.backupConfigSha256 && pending.backupConfigSha256 !== manifest.configSha256) {
      throw new Error(`The recorded target backup at ${resolved} no longer has its expected configuration checksum.`);
    }
  }
  return { path: resolved, manifest };
}
