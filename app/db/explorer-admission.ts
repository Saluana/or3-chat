import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { MAX_PENDING_OPS, countQueuedSyncOperations } from '~/core/sync/outbox-queue';
import { useOverlay } from '@nuxt/ui/composables/useOverlay';

const acceptedOnDevice = new Set<string>();
const pendingNotices = new Map<string, Promise<boolean>>();

async function confirmCompatibility(signal: AbortSignal): Promise<boolean> {
    const { default: Notice } = await import('~/components/files/ExplorerCompatibilityNotice.vue');
    signal.throwIfAborted();
    const prompt = useOverlay().create(Notice, { destroyOnClose: true });
    const cancel = () => prompt.close(false);
    signal.addEventListener('abort', cancel, { once: true });
    try {
        return await prompt.open().result === true;
    } finally {
        signal.removeEventListener('abort', cancel);
        prompt.close(false);
    }
}

export async function admitExplorerWrite(origin: WorkspaceOperationScope): Promise<void> {
    origin.assertCurrent('write');
    if (origin.explorerLocal) return;
    if (!origin.explorerCloud) throw new Error('Folder organization is unavailable for this workspace.');
    const key = 'or3:explorer:v1:' + JSON.stringify([origin.subject, origin.workspaceId]);
    if (acceptedOnDevice.has(key)) return;
    try {
        if (window.localStorage.getItem(key) === 'accepted') return;
    } catch {
        // A private or storage-restricted browser keeps the acknowledgement in memory.
    }
    let pending = pendingNotices.get(key);
    if (!pending) {
        pending = confirmCompatibility(origin.signal).finally(() => pendingNotices.delete(key));
        pendingNotices.set(key, pending);
    }
    if (!await pending) {
        throw new Error('Folder changes were canceled.');
    }
    origin.assertCurrent('write');
    acceptedOnDevice.add(key);
    try { window.localStorage.setItem(key, 'accepted'); } catch {}
}

export async function assertExplorerQueueCapacity(origin: WorkspaceOperationScope, added: number): Promise<void> {
    if (!origin.explorerCloud || !added) return;
    const pending = await countQueuedSyncOperations(origin.db);
    if (pending + added >= MAX_PENDING_OPS) {
        throw Object.assign(new Error(`This change would fill the sync queue (${pending} changes waiting). Wait for sync to catch up and try again.`),
            { code: 'explorer-queue-full' });
    }
}
