import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function deploymentPaths(directory: string) {
  const cloud = join(directory, '.or3-cloud');
  return {
    env: join(directory, '.env'),
    state: join(cloud, 'state.json'),
    operations: join(cloud, 'operations'),
    backups: join(cloud, 'backups'),
    exports: join(cloud, 'exports'),
    lastOperation: join(cloud, 'last-operation.json'),
    lease: join(cloud, 'operation-lease'),
    backupAuthKey: join(cloud, 'backup-auth.key'),
    operatorIpc: join(cloud, 'operator-ipc'),
  };
}

export async function readDirectoryEmpty(directory: string) {
  try {
    const entries = await readdir(directory);
    const nonLeaseEntries = entries.filter((entry) => entry !== '.or3-cloud');
    if (nonLeaseEntries.length) throw new Error(`Refusing to use non-empty directory ${directory}. Choose a new directory or run adopt explicitly.`);
    if (entries.includes('.or3-cloud')) {
      const cloudEntries = await readdir(join(directory, '.or3-cloud'));
      if (cloudEntries.some((entry) => entry !== 'operation-lease')) {
        throw new Error(`Refusing to use non-empty directory ${directory}. Choose a new directory or run adopt explicitly.`);
      }
    }
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

export function backupDirectory(directory: string, backupId: string) {
  return join(deploymentPaths(directory).backups, backupId);
}
