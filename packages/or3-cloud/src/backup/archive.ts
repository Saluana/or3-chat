import { createReadStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
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

export async function validateVolumeArchive(directory: string, _mode: Mode, env: Record<string, string>, backupPath: string) {
  await streamFileToCommand(
    'docker',
    [
      'run', '--rm', '-i', '--network', 'none', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
      '--entrypoint', 'sh', env.OR3_IMAGE, '-c',
      'tar tzf - >/dev/null',
    ],
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}
