import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { secretValues } from '../deployment/env';
import { run, streamFileToCommand } from '../runtime/command-runner';
import { redact } from '../util/primitives';
import { assertEnoughFreeSpace } from './archive';

const INSPECTOR = '/app/scripts/docker/backup-inspect.mjs';
const NODE = 'if [ -x /nodejs/bin/node ]; then exec /nodejs/bin/node "$@"; else exec node "$@"; fi';

/** App-owned contract v1. Unsupported profiles never certify partial coverage. */
export async function validateCanonicalBackupReferences(directory: string, env: Record<string, string>, backupPath: string) {
  if (env.OR3_SYNC_PROVIDER !== 'sqlite' || env.NUXT_PUBLIC_STORAGE_PROVIDER !== 'fs' || env.OR3_SQLITE_DRIVER && env.OR3_SQLITE_DRIVER !== 'better-sqlite3') {
    throw new Error('Unsupported offline backup inspection provider profile; SQLite/FS is required.');
  }
  const helper = `or3-backup-inspection-${randomUUID()}`;
  const checked = async (args: string[]) => {
    const result = await run('docker', args, directory);
    if (!result.ok) throw new Error(`Offline backup reference inspection failed or is unsupported. ${redact(result.stderr, secretValues(env))}`);
    return result.stdout.trim();
  };
  let primary: unknown;
  try {
    // A private tmpfs bounds scratch use independently of the live volume.
    // Lifetime also bounds hung scans if the invoking Docker client is killed.
    await checked(['run', '--pull', 'never', '--rm', '--detach', '--name', helper, '--network', 'none', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--memory', '256m', '--cpus', '0.5', '--pids-limit', '32',
      '--tmpfs', '/scratch:rw,noexec,nosuid,nodev,size=512m,mode=700,uid=65532,gid=65532', '--entrypoint', 'sh', env.OR3_IMAGE, '-c', 'sleep 240']);
    await streamFileToCommand('docker', ['exec', '-i', helper, 'sh', '-c', 'ulimit -f 16384; tar tvzf - > /scratch/inventory'], join(backupPath, 'data.tgz'), directory, secretValues(env));
    const inventory = JSON.parse(await checked(['exec', helper, 'sh', '-c', NODE, 'or3-backup-inspection', INSPECTOR, 'inventory'])) as { selected: string[]; bytes: number };
    if (!Array.isArray(inventory.selected) || !inventory.selected.includes('./sync.sqlite') && !inventory.selected.includes('sync.sqlite')
      || inventory.selected.some(name => !/^(?:\.\/)?sync[.]sqlite(?:-wal)?$/.test(name))
      || inventory.selected.length > 2 || !Number.isSafeInteger(inventory.bytes) || inventory.bytes < 0) throw new Error('Invalid offline backup inspection inventory response.');
    const freeKiB = Number(await checked(['exec', helper, 'sh', '-c', "df -Pk /scratch | awk 'NR == 2 { print $4 }'"]));
    if (!Number.isFinite(freeKiB) || freeKiB < 0) throw new Error('Could not verify offline backup scratch capacity.');
    assertEnoughFreeSpace(freeKiB * 1024, inventory.bytes, 'Offline backup inspection scratch');
    await streamFileToCommand('docker', ['exec', '-i', helper, 'tar', '-xz', '-f', '-', '-C', '/scratch', ...inventory.selected], join(backupPath, 'data.tgz'), directory, secretValues(env));
    const result = JSON.parse(await checked(['exec', helper, 'sh', '-c', NODE, 'or3-backup-inspection', INSPECTOR, 'references', env.OR3_STORAGE_FS_ROOT ?? '/data/storage']));
    if (result.contract !== 1 || result.complete !== true || !Number.isSafeInteger(result.liveAttachments) || result.liveAttachments < 0) throw new Error('Offline canonical backup reference inspection did not complete.');
  } catch (error) { primary = error; }
  const cleanup = await run('docker', ['rm', '--force', helper], directory);
  if (!cleanup.ok && !/No such container/i.test(cleanup.stderr)) {
    throw new AggregateError(primary ? [primary] : [], `Offline backup inspection helper cleanup failed. ${redact(cleanup.stderr, secretValues(env))}`);
  }
  if (primary) throw primary;
}
