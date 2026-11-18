import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { MAX_PENDING_OPS, countQueuedSyncOperations } from '~/core/sync/outbox-queue';
export async function admitExplorerWrite(origin: WorkspaceOperationScope): Promise<void> {
    origin.assertCurrent('write');
    if (!origin.explorerLocal && !origin.explorerCloud) throw new Error('Folder organization is unavailable for this workspace.');
}

export async function assertExplorerQueueCapacity(origin: WorkspaceOperationScope, added: number): Promise<void> {
    if (!origin.explorerCloud || !added) return;
    const pending = await countQueuedSyncOperations(origin.db);
    if (pending + added >= MAX_PENDING_OPS) {
        throw Object.assign(new Error(`This change would fill the sync queue (${pending} changes waiting). Wait for sync to catch up and try again.`),
            { code: 'explorer-queue-full' });
    }
}
