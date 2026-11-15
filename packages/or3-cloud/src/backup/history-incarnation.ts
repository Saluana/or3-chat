import { randomUUID } from 'node:crypto';
import type { BackupManifest, ManagedState } from '../deployment/contracts';
import { updatePending, writeState } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import { imageAtDigest } from '../deployment/identity';

const helper = '/app/scripts/docker/sync-history-reset.mjs';
const node = 'if [ -x /nodejs/bin/node ]; then exec /nodejs/bin/node "$@"; else exec node "$@"; fi';
async function historyCommand(directory: string, image: string, args: string[], volume?: string) {
    return run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
        ...(volume ? ['-v', `${volume}:/data`] : []), '--entrypoint', 'sh', image, '-c', node, 'or3-history-reset', helper, ...args], directory);
}
export async function supportsHistoryReset(directory: string, image: string): Promise<boolean> {
    const result = await historyCommand(directory, image, ['capability']);
    try { return result.ok && JSON.parse(result.stdout).contract === 'incarnation-v1'; } catch { return false; }
}
export async function requireHistoryResetTarget(directory: string, image: string): Promise<void> {
    if (!await supportsHistoryReset(directory, image)) throw new Error('Target image lacks qualified history incarnation reset/runtime v1; normal restore/rollback refused before data replacement');
}
/** Authoritative journal precedes every extraction, including safety re-extraction. */
export async function prepareHistoryReset(directory: string, state: ManagedState, manifest: BackupManifest, safety: boolean) {
    const attempt = { id: randomUUID(), historyIncarnation: randomUUID(), role: safety ? 'safety' as const : 'target' as const,
        backupDataSha256: manifest.dataSha256, targetImageDigest: manifest.imageDigest, progress: 'prepared' as const };
    await updatePending(directory, state, { historyReset: attempt });
    state.pinnedHistoryBackups = [...new Set([...(state.pinnedHistoryBackups ?? []), ...(state.incompleteOperation?.previousBackupId ? [state.incompleteOperation.previousBackupId] : []), manifest.backupId])];
    await writeState(directory, state);
    return attempt;
}
export async function commitHistoryReset(directory: string, state: ManagedState, manifest: BackupManifest, databasePath: string, safety: boolean) {
    const attempt = state.incompleteOperation?.historyReset;
    if (!attempt || attempt.progress !== 'prepared' || attempt.backupDataSha256 !== manifest.dataSha256 || attempt.targetImageDigest !== manifest.imageDigest) throw new Error('Missing matching reset journal');
    const result = await historyCommand(directory, imageAtDigest(manifest.image, manifest.imageDigest), ['reset', databasePath, attempt.historyIncarnation], state.volumeName);
    let response: { contract?: string; historyIncarnation?: string; reset?: boolean } = {};
    try { response = JSON.parse(result.stdout) as typeof response; } catch { /* Fail closed below. */ }
    if (!result.ok || response.contract !== 'incarnation-v1' || response.historyIncarnation !== attempt.historyIncarnation || !response.reset) throw new Error('Offline history reset failed; writers must remain stopped');
    state.syncHistory = { historyIncarnation: attempt.historyIncarnation, certification: safety ? 'degraded' : 'pending' };
    await updatePending(directory, state, { historyReset: { ...attempt, progress: 'reset-complete' } });
}
