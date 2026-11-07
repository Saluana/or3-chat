import { createError } from 'h3';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { requireExternalStorageGenerationPair } from './generation-coordination';
import { withAdminJournal } from '../../admin/activity/journal';
import type { StorageGenerationCandidatePage } from '../../admin/stores/types';

function qualified() {
    const storage = getActiveStorageGatewayAdapter();
    const coordinator = requireExternalStorageGenerationPair(getActiveSyncGatewayAdapter(), storage);
    const reclaimBatch = storage?.externalStorageGenerations?.reclaimBatch;
    if (typeof reclaimBatch !== 'function') throw createError({ statusCode: 503, statusMessage: 'Storage cleanup is not qualified' });
    return { coordinator, reclaimBatch };
}

export async function runStorageCleanupBatch(actor: string, input: { workspaceId: string; cursor?: string; generationIds: string[] }) {
    const { coordinator, reclaimBatch } = qualified();
    return withAdminJournal({ actor, action: 'storage.cleanup', target: { kind: 'workspace', id: input.workspaceId }, before: { cursor: input.cursor ?? null, selected: input.generationIds.length } },
        () => reclaimBatch({ ...input, retentionSeconds: 7 * 86_400, limit: 25 }, coordinator),
        result => ({ ...result }));
}

export async function runAutomaticStorageCleanupBatch(workspaceId: string, cursor?: string) {
    const { coordinator } = qualified();
    const inspector = coordinator as typeof coordinator & { inspectCandidates?(input: { workspaceId: string; cursor?: string; retentionSeconds: number; limit: number }): Promise<StorageGenerationCandidatePage> };
    if (!inspector.inspectCandidates) throw createError({ statusCode: 503, statusMessage: 'Storage retention inspection is unavailable' });
    const page = await inspector.inspectCandidates({ workspaceId, cursor, retentionSeconds: 7 * 86_400, limit: 25 });
    // Provider responses still need runtime validation at the trust boundary.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (page.workspaceId !== workspaceId || page.legacyIncluded !== false || page.retentionSeconds !== 7 * 86_400 || page.items.length > 25) throw new Error('Invalid retention scope');
    const generationIds = page.items.filter(item => item.status === 'eligible' || item.status === 'claimed').map(item => item.generation.generationId);
    if (!generationIds.length) return { nextCursor: page.nextCursor, pending: 0 };
    return runStorageCleanupBatch('system:storage-retention', { workspaceId, cursor, generationIds });
}
