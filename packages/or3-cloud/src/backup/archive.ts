import { createReadStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, posix } from 'node:path';
import { createGunzip } from 'node:zlib';
import type { Mode } from '../deployment/contracts';
import { secretValues } from '../deployment/env';
import { readState } from '../deployment/state-store';
import { run, streamCommandToFile, streamFileToCommand } from '../runtime/command-runner';
import { composeArgs } from '../runtime/compose';
import { ensureManagedDataVolume } from '../runtime/volumes';
import { redact } from '../util/primitives';

const FREE_SPACE_HEADROOM_BYTES = 64 * 1024 * 1024;

/** Total bytes an operation needs on disk: required data plus reserve headroom. */
export function requiredArchiveSpace(requiredBytes: number) {
  return requiredBytes + Math.max(Math.ceil(requiredBytes / 2), FREE_SPACE_HEADROOM_BYTES);
}

/** Pure free-space gate: fails when free bytes cannot cover the archive plus headroom. */
export function assertEnoughFreeSpace(freeBytes: number, requiredBytes: number, label: string) {
  const needed = requiredArchiveSpace(requiredBytes);
  if (freeBytes < needed) {
    throw new Error(`${label} needs at least ${needed} bytes of free space (${requiredBytes} required plus reserve headroom) but only ${freeBytes} bytes are available. Free disk space or move backups off-host before retrying.`);
  }
}

/**
 * Preflight for archive operations. Checks the filesystem that holds
 * `targetPath` (the directory the archive will be written into) via statfs,
 * which reports free blocks for the unprivileged user. Used before a backup
 * writes data.tgz and before a restore extracts one.
 */
export async function assertFreeSpaceForArchive(targetPath: string, requiredBytes: number, label: string) {
  let stats;
  try {
    stats = await statfs(dirname(targetPath));
  } catch (error) {
    throw new Error(`Could not check free disk space for ${dirname(targetPath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertEnoughFreeSpace(Number(stats.bavail) * Number(stats.bsize), requiredBytes, label);
}

export async function gzipUncompressedBytes(path: string) {
  let bytes = 0;
  const counter = new Writable({
    write(chunk, _encoding, callback) {
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      callback();
    },
  });
  await pipeline(createReadStream(path), createGunzip(), counter);
  return bytes;
}

export async function volumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupDir: string) {
  await streamCommandToFile(
    'docker',
    composeArgs(directory, mode, [
      'run', '--rm', '--no-deps', '--entrypoint', 'sh', 'or3', '-c',
      'tar czf - -C /data .',
    ]),
    join(backupDir, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

export async function archiveExternalVolume(image: string, volume: string, backupDir: string) {
  // Source V1 volumes may be root-owned, so the reader stays root. The archive
  // itself is streamed to a file opened by this user, avoiding root-owned 0600
  // backups on ordinary Linux Docker hosts.
  await streamCommandToFile(
    'docker',
    [
      'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-v', `${volume}:/source:ro`,
      image, 'sh', '-c', 'tar czf - -C /source .',
    ],
    join(backupDir, 'data.tgz'),
  );
}

export async function restoreVolumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupPath: string) {
  // Host backups intentionally stay 0700/0600. Stream the archive over stdin
  // so the normal image user can write its owned /data volume without either
  // exposing the backup through a bind mount or forcing a capability-less root.
  const state = await readState(directory);
  await ensureManagedDataVolume(directory, mode, state, env);
  const clear = await run('docker', [
    'run', '--rm', '--network', 'none', '--user', '0:0', '--read-only',
    '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
    '--security-opt', 'no-new-privileges:true', '-v', `${state.volumeName}:/data`,
    '--entrypoint', 'sh', env.OR3_IMAGE, '-c', 'find /data -mindepth 1 -delete',
  ], directory);
  if (!clear.ok) {
    throw new Error(`Could not safely clear the managed data volume before restore. ${redact(clear.stderr, secretValues(env))}`);
  }
  await streamFileToCommand(
    'docker',
    [
      'run', '--rm', '-i', '--network', 'none', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
      '-v', `${state.volumeName}:/data`, '--entrypoint', 'sh', env.OR3_IMAGE, '-c',
      'tar xzf - -C /data',
    ],
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

export async function validateVolumeArchive(directory: string, _mode: Mode, env: Record<string, string>, backupPath: string, archivedStorageRoot?: string) {
  const storageRoot = posix.relative('/data', archivedStorageRoot ?? env.OR3_STORAGE_FS_ROOT ?? '/data/storage');
  // Only the managed /data tree is captured. Do not interpret unrelated
  // metadata or opaque generation artifacts as current filesystem objects.
  const storagePrefix = storageRoot === '..' || storageRoot.startsWith('../') || posix.isAbsolute(storageRoot)
    ? '' : `${storageRoot ? `${storageRoot}/` : ''}workspaces/`;
  await streamFileToCommand(
    'docker',
    [
      'run', '--rm', '-i', '--network', 'none', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
      '--entrypoint', 'sh', env.OR3_IMAGE, '-c',
      // A structurally valid archive can still omit a database. Starting the
      // app may create an empty replacement and make deep health green while
      // accounts or canonical workspace data have been lost. Require both
      // fixed-profile payloads before extraction can clear the live volume.
      // A committed FS sidecar also requires its canonical blob entry. Orphan
      // uploads and temporary/opaque generation artifacts remain valid. awk
      // is already part of the managed image's free-space probe contract.
      // Pass tar's exit status through the stream too: legacy /bin/sh may not
      // support pipefail, and a listing error must never be hidden by a reader.
      `{ tar tzf -; printf '\\nOR3_TAR_RESULT:%s\\n' "$?"; } | awk -v prefix="$1" '
{
  entry = $0
  sub(/^\\.\\//, "", entry)
  if (entry == "auth.sqlite") auth = 1
  if (entry == "sync.sqlite") sync = 1
  if (entry ~ /^OR3_TAR_RESULT:[0-9]+$/) {
    seen_status = 1
    sub(/^OR3_TAR_RESULT:/, "", entry)
    tar_status = entry
    next
  }
  if (prefix != "" && index(entry, prefix) == 1) {
    path = substr(entry, length(prefix) + 1)
    if (split(path, parts, "/") != 2 || parts[1] !~ /^[a-zA-Z0-9_-]+$/) next
    key = parts[2]
    sidecar = sub(/[.]meta[.]json$/, "", key)
    if ((key ~ /^sha256_[a-fA-F0-9]+$/ && length(key) == 71) || (key ~ /^md5_[a-fA-F0-9]+$/ && length(key) == 36)) {
      if (sidecar) metadata[entry] = 1
      else payloads[entry] = 1
    }
  }
}
END {
  if (!seen_status || tar_status != "0") exit 1
  if (!auth || !sync) {
    print "Backup archive is missing required managed database payloads (auth.sqlite and sync.sqlite)." > "/dev/stderr"
    exit 1
  }
  for (entry in metadata) {
    payload = entry
    sub(/[.]meta[.]json$/, "", payload)
    if (!(payload in payloads)) {
      print "Backup archive contains a committed filesystem metadata sidecar without its required blob payload." > "/dev/stderr"
      exit 1
    }
  }
}'`, 'or3-archive-validation', storagePrefix,
    ],
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}
