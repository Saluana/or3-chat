import { join } from 'node:path';
import { withBackupHelper } from './helper';
import { assertSupportedBackupProfile } from './references';
import { randomUUID } from 'node:crypto';
import type { BackupManifest, ManagedState, LegacySnapshotPolicy } from '../deployment/contracts';
import { updatePending, writeState } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import { imageAtDigest } from '../deployment/identity';
import { isQualifiedLegacyImage } from '../runtime/images';

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
    const attempt = { kind: 'incarnation-reset' as const, id: randomUUID(), historyIncarnation: randomUUID(), role: safety ? 'safety' as const : 'target' as const,
        backupDataSha256: manifest.dataSha256, targetImageDigest: manifest.imageDigest, progress: 'prepared' as const };
    await updatePending(directory, state, { historyReset: attempt });
    state.pinnedHistoryBackups = [...new Set([...(state.pinnedHistoryBackups ?? []), ...(state.incompleteOperation?.previousBackupId ? [state.incompleteOperation.previousBackupId] : []), manifest.backupId])];
    await writeState(directory, state);
    return attempt;
}
export async function commitHistoryReset(directory: string, state: ManagedState, manifest: BackupManifest, databasePath: string, safety: boolean) {
    const attempt = state.incompleteOperation?.historyReset;
    if (!attempt || attempt.kind === 'legacy-snapshot' || attempt.progress !== 'prepared' || attempt.backupDataSha256 !== manifest.dataSha256 || attempt.targetImageDigest !== manifest.imageDigest) throw new Error('Missing matching reset journal');
    const result = await historyCommand(directory, imageAtDigest(manifest.image, manifest.imageDigest), ['reset', databasePath, attempt.historyIncarnation], state.volumeName);
    let response: { contract?: string; historyIncarnation?: string; reset?: boolean } = {};
    try { response = JSON.parse(result.stdout) as typeof response; } catch { /* Fail closed below. */ }
    if (!result.ok || response.contract !== 'incarnation-v1' || response.historyIncarnation !== attempt.historyIncarnation || !response.reset) throw new Error('Offline history reset failed; writers must remain stopped');
    state.syncHistory = { historyIncarnation: attempt.historyIncarnation, certification: safety ? 'degraded' : 'pending' };
    await updatePending(directory, state, { historyReset: { ...attempt, progress: 'reset-complete' } });
}

/** Capability is bound by callers to the exact pulled candidate digest. */
export async function requireValidationTarget(directory: string, image: string): Promise<void> {
    const result = await historyCommand(directory, image, ['capability']);
    let capability: { contract?: string; validation?: string; profile?: string } = {};
    try { capability = JSON.parse(result.stdout) as typeof capability; } catch { /* Refuse below. */ }
    if (!result.ok || capability.contract !== 'incarnation-v1' || capability.validation !== 'health-only-v1' || capability.profile !== 'basic-sqlite-fs') {
        throw new Error('Target lacks qualified health-only validation capability for Basic Auth + SQLite + filesystem; update refused before downtime');
    }
}

export async function qualifyLegacySnapshot(directory: string, state: ManagedState, manifest: BackupManifest,
  env: Record<string,string>, inspectorImage: string, backupPath?: string): Promise<LegacySnapshotPolicy> {
  const pending = state.incompleteOperation;
  const immediate = pending?.operation === 'update' && pending.backupId === manifest.backupId
    || pending?.previousBackupId === manifest.backupId && !pending.admission
    || state.rollback?.backupId === manifest.backupId
    || !backupPath && manifest.imageDigest === state.imageDigest;
  if (!immediate || !isQualifiedLegacyImage(manifest)
    || manifest.schemaVersion !== 1) throw new Error('Source is not the qualified immediate legacy 032 snapshot');
  assertSupportedBackupProfile(env);
  const capability = await historyCommand(directory, inspectorImage, ['capability']);
  let profile: { legacySnapshotRollback?: string } = {};
  try { profile = JSON.parse(capability.stdout) as typeof profile; } catch { /* Refuse below. */ }
  if (!capability.ok || profile.legacySnapshotRollback !== 'legacy-032-rollback-v1') throw new Error('Legacy snapshot rollback remains unqualified; exact image/browser/lifecycle qualification required');
  const inspectArgs = ['sh', '-c', node, 'or3-legacy-inspection', '/app/scripts/docker/backup-inspect.mjs', 'legacy'];
  let output: string;
  if (backupPath) {
    output = await withBackupHelper(directory, inspectorImage, env, { network: 'none' }, async helper => {
      await helper.loadSqlite(join(backupPath, 'data.tgz'), true);
      return helper.exec(inspectArgs);
    });
  } else {
    const result = await run('docker', ['run','--rm','--network','none','--read-only','--security-opt','no-new-privileges:true','--cap-drop','ALL','--memory','256m','--cpus','0.5','--pids-limit','32',
      '-v', `${state.volumeName}:/data:ro`, '--entrypoint','sh', inspectorImage, ...inspectArgs.slice(1), '/data'], directory);
    if (!result.ok) throw new Error('Offline legacy source inspection failed');
    output = result.stdout;
  }
  const evidence = JSON.parse(output) as { policy?: string; ledger?: string; complete?: boolean; payloadSha256?: Record<string,string|null> };
  if (evidence.policy !== 'legacy-032-rollback-v1' || evidence.ledger !== '032' || !evidence.complete || !evidence.payloadSha256
    || !['sync.sqlite','auth.sqlite'].every(key => /^[a-f0-9]{64}$/.test(evidence.payloadSha256?.[key] ?? ''))) throw new Error('Incomplete legacy source inspection');
  return { kind: 'legacy-snapshot', policy: 'legacy-032-rollback-v1', backupId: manifest.backupId, inspectorImage,
    ledger: '032', profile: 'basic-sqlite-fs', payloadSha256: evidence.payloadSha256 };
}
export async function prepareLegacyReplacement(directory: string, state: ManagedState, manifest: BackupManifest, policy: LegacySnapshotPolicy, safety: boolean) {
  const pending = state.incompleteOperation;
  if (!pending || policy.backupId !== manifest.backupId || pending.admission?.state !== 'closed' && !pending.explicitLossConsent) throw new Error('Legacy replacement requires closed admission or explicit loss consent');
  const attempt = { kind: 'legacy-snapshot' as const, id: randomUUID(), role: safety ? 'safety' as const : 'target' as const,
    policy: policy.policy, backupId: manifest.backupId, backupDataSha256: manifest.dataSha256,
    backupConfigSha256: manifest.configSha256!, managedAssetSha256: manifest.managedAssetSha256!, targetImageDigest: manifest.imageDigest,
    ledger: policy.ledger, profile: policy.profile, abandonedIncarnation: state.syncHistory?.historyIncarnation ?? state.syncHistory?.abandonedIncarnation,
    explicitLossConsent: pending.explicitLossConsent === true, safetyBackupId: pending.abandonedBackupId ?? pending.previousBackupId,
    progress: 'prepared' as const };
  state.pinnedHistoryBackups = [...new Set([...(state.pinnedHistoryBackups ?? []), manifest.backupId,
    ...(attempt.safetyBackupId ? [attempt.safetyBackupId] : [])])];
  await updatePending(directory, state, { historyReset: attempt });
}
export async function verifyLegacyReplacement(directory: string, state: ManagedState, manifest: BackupManifest, policy: LegacySnapshotPolicy) {
  const attempt = state.incompleteOperation?.historyReset;
  if (attempt?.kind !== 'legacy-snapshot' || attempt.progress !== 'prepared' || attempt.backupDataSha256 !== manifest.dataSha256
    || attempt.targetImageDigest !== manifest.imageDigest) throw new Error('Missing legacy replacement journal');
  const result = await run('docker', ['run','--rm','--network','none','--read-only','--security-opt','no-new-privileges:true','--cap-drop','ALL','--memory','256m','--cpus','0.5','--pids-limit','32',
    '-v', `${state.volumeName}:/data`, '--entrypoint','sh', policy.inspectorImage, '-c', node, 'or3-legacy-inspection',
    '/app/scripts/docker/backup-inspect.mjs', 'legacy', '/data'], directory);
  const evidence = result.ok ? JSON.parse(result.stdout) as { payloadSha256?: Record<string,string|null> } : undefined;
  if (!evidence?.payloadSha256 || JSON.stringify(Object.entries(evidence.payloadSha256).sort()) !== JSON.stringify(Object.entries(policy.payloadSha256).sort())) throw new Error('Extracted legacy database/sidecar hashes do not match authenticated source');
  state.syncHistory = { certification: 'legacy-snapshot', historyReplaced: true, sourceBackupId: manifest.backupId,
    abandonedIncarnation: attempt.abandonedIncarnation, reupgradeRequired: true };
  await updatePending(directory, state, { historyReset: { ...attempt, progress: 'verified' } });
}
