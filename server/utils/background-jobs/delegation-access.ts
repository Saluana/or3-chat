import { useRuntimeConfig } from '#imports';
import { can } from '../../auth/can';
import { getAuthWorkspaceStore } from '../../auth/store/registry';
import { getSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getChatJobExecution, type BackgroundJob } from './types';

/** Check current permission for a persisted job without treating an outage as a denial. */
export async function checkDelegationAccess(job: BackgroundJob, requireThread: boolean, requireMissingThread = false): Promise<'allowed' | 'denied' | 'unavailable'> {
    const execution = getChatJobExecution(job);
    const providerId = job.syncProviderId;
    if (!execution || !providerId || (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider !== providerId)
        return 'unavailable';
    const store = getAuthWorkspaceStore(providerId);
    if (!store) return 'unavailable';
    const allowed = async () => {
        const membership = (await store.listUserWorkspaces(job.userId)).find(row => row.id === execution.workspaceId);
        return !!membership && can({ authenticated: true, user: { id: job.userId },
            workspace: { id: execution.workspaceId, name: membership.name }, role: membership.role },
            'workspace.write', { kind: 'workspace', id: execution.workspaceId }).allowed;
    };
    if (!await allowed()) return 'denied';
    if (!requireThread) return 'allowed';
    const adapter = getSyncGatewayAdapter(providerId);
    if (adapter?.capabilities?.canonicalChatHistory !== 'v1' || !adapter.readChatHistory) return 'unavailable';
    const result = await adapter.readChatHistory({ userId: job.userId, workspaceId: execution.workspaceId },
        { kind: 'thread', thread_id: job.threadId }, AbortSignal.timeout(10_000));
    if (!await allowed()) return 'denied';
    if (result.status !== 'ok') return 'unavailable';
    if (!result.thread || result.thread.deleted) return requireMissingThread ? 'allowed' : 'denied';
    if (requireMissingThread || result.thread.project_id) return 'denied';
    return result.project_ownership === 'resolved' ? 'allowed' : 'unavailable';
}
