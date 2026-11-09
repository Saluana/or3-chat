import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { secretValues } from '../deployment/env';
import { run, streamCommandToFile, streamFileToCommand } from '../runtime/command-runner';
import { redact } from '../util/primitives';
import { assertEnoughFreeSpace } from './archive';

const INSPECTOR = '/app/scripts/docker/backup-inspect.mjs';
const NODE = 'if [ -x /nodejs/bin/node ]; then exec /nodejs/bin/node "$@"; else exec node "$@"; fi';
const S3_ENV = new Set([
  'OR3_STORAGE_S3_ENDPOINT', 'OR3_STORAGE_S3_REGION', 'OR3_STORAGE_S3_BUCKET',
  'OR3_STORAGE_S3_ACCESS_KEY_ID', 'OR3_STORAGE_S3_SECRET_ACCESS_KEY', 'OR3_STORAGE_S3_SESSION_TOKEN',
  'OR3_STORAGE_S3_FORCE_PATH_STYLE', 'OR3_STORAGE_S3_KEY_PREFIX', 'OR3_STORAGE_S3_ALLOW_INSECURE_HTTP',
  'OR3_BACKUP_S3_ENDPOINT_ORIGIN', 'OR3_BACKUP_S3_BUCKET', 'OR3_BACKUP_S3_KEY_PREFIX',
  'OR3_BACKUP_ARCHIVE_SHA256',
]);
const S3_SECRETS = new Set(['OR3_STORAGE_S3_ACCESS_KEY_ID', 'OR3_STORAGE_S3_SECRET_ACCESS_KEY', 'OR3_STORAGE_S3_SESSION_TOKEN']);

type BackupHelper = {
  exec(args: string[]): Promise<string>;
  execFromFile(args: string[], file: string): Promise<void>;
  execToFile(args: string[], file: string): Promise<void>;
  loadSqlite(dataTgz: string): Promise<void>;
};

/** Runs one confined image helper and always attempts to remove it. */
export async function withBackupHelper<T>(
  directory: string,
  image: string,
  env: Record<string, string>,
  options: { network: 'none' | 'egress'; passEnv?: readonly string[]; lifetimeSeconds?: number; archiveFile?: string },
  body: (helper: BackupHelper) => Promise<T>,
): Promise<T> {
  const name = `or3-backup-inspection-${randomUUID()}`;
  const names = options.passEnv ?? [];
  if (names.some(key => !S3_ENV.has(key) || options.network === 'none' && S3_SECRETS.has(key))) throw new Error('Invalid backup helper environment selection.');
  const lifetime = options.lifetimeSeconds ?? (options.network === 'none' ? 240 : 14_400);
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 14_400) throw new Error('Invalid backup helper lifetime.');
  const streamTimeout = options.network === 'egress' || options.lifetimeSeconds !== undefined ? lifetime * 1000 : undefined;
  let archiveMount: string[] = [];
  let helperUid = 65532, helperGid = 65532;
  if (options.archiveFile !== undefined) {
    if (!isAbsolute(options.archiveFile) || /[,\r\n]/.test(options.archiveFile)) throw new Error('Invalid recovery archive path.');
    const info = await lstat(options.archiveFile);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('Recovery archive must be a private regular file owned by the operator.');
    const canonical = await realpath(options.archiveFile);
    if (/[,\r\n]/.test(canonical)) throw new Error('Invalid recovery archive path.');
    archiveMount = ['--mount', `type=bind,src=${canonical},dst=/or3-backup.tar,readonly`];
    helperUid = info.uid; helperGid = info.gid;
  }
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of S3_ENV) delete environment[key];
  for (const key of names) {
    if (env[key] !== undefined) environment[key] = env[key];
  }
  const secrets = secretValues(env);
  const checked = async (args: string[]) => {
    const result = await run('docker', args, directory, environment);
    if (!result.ok) throw new Error(`Offline backup reference inspection failed or is unsupported. ${redact(result.stderr, secrets)}`);
    return result.stdout.trim();
  };
  let primary: unknown;
  let value: T | undefined;
  try {
    await checked(['run', '--pull', 'never', '--rm', '--detach', '--name', name, '--network', options.network === 'none' ? 'none' : 'bridge', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--memory', '256m', '--cpus', '0.5', '--pids-limit', '32',
      ...(options.archiveFile ? ['--user', `${helperUid}:${helperGid}`] : []),
      '--tmpfs', `/scratch:rw,noexec,nosuid,nodev,size=512m,mode=700,uid=${helperUid},gid=${helperGid}`,
      ...archiveMount,
      ...names.filter(key => env[key] !== undefined).flatMap(key => ['--env', key]), '--entrypoint', 'sh', image, '-c', `sleep ${lifetime}`]);
    const helper: BackupHelper = {
      exec: args => checked(['exec', name, ...args]),
      execFromFile: async (args, file) => streamFileToCommand('docker', ['exec', '-i', name, ...args], file, directory, secrets, environment, streamTimeout),
      execToFile: async (args, file) => streamCommandToFile('docker', ['exec', name, ...args], file, directory, secrets, environment, streamTimeout),
      async loadSqlite(dataTgz) {
        await this.execFromFile(['sh', '-c', 'ulimit -f 16384; tar tvzf - > /scratch/inventory'], dataTgz);
        const inventory = JSON.parse(await this.exec(['sh', '-c', NODE, 'or3-backup-inspection', INSPECTOR, 'inventory'])) as { selected: string[]; bytes: number };
        if (!Array.isArray(inventory.selected) || !inventory.selected.includes('./sync.sqlite') && !inventory.selected.includes('sync.sqlite')
          || inventory.selected.some(item => !/^(?:\.\/)?sync[.]sqlite(?:-wal)?$/.test(item))
          || inventory.selected.length > 2 || !Number.isSafeInteger(inventory.bytes) || inventory.bytes < 0) throw new Error('Invalid offline backup inspection inventory response.');
        const freeKiB = Number(await this.exec(['sh', '-c', "df -Pk /scratch | awk 'NR == 2 { print $4 }'"]));
        if (!Number.isFinite(freeKiB) || freeKiB < 0) throw new Error('Could not verify offline backup scratch capacity.');
        assertEnoughFreeSpace(freeKiB * 1024, inventory.bytes, 'Offline backup inspection scratch');
        await this.execFromFile(['tar', '-xz', '-f', '-', '-C', '/scratch', ...inventory.selected], dataTgz);
      },
    };
    value = await body(helper);
  } catch (error) { primary = error; }
  const cleanup = await run('docker', ['rm', '--force', name], directory, environment);
  if (!cleanup.ok && !/No such container/i.test(cleanup.stderr)) {
    throw new AggregateError(primary ? [primary] : [], `Offline backup inspection helper cleanup failed. ${redact(cleanup.stderr, secrets)}`);
  }
  if (primary) throw primary;
  return value as T;
}
