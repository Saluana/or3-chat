import { defineEventHandler, getQuery } from 'h3';
import { requireSupportAdmin, requireTargetId } from '../../../admin/customers';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';
import { getActiveSyncGatewayAdapter } from '../../../sync/gateway/registry';
import { getActiveStorageGatewayAdapter } from '../../../storage/gateway/registry';
import { requireExternalStorageGenerationPair } from '../../../utils/storage/generation-coordination';

/** Explicit, bounded read. No physical target, claim or deletion command is accepted. */
export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    enforceGenericAdminRateLimit(event, 'storage-preview');
    const query = getQuery(event);
    const workspaceId = requireTargetId(typeof query.workspaceId === 'string' ? query.workspaceId : undefined);
    const cursor = query.cursor === undefined ? undefined : requireTargetId(typeof query.cursor === 'string' ? query.cursor : undefined);
    const store = getWorkspaceAccessStore(event);
    const storageProviderId = useRuntimeConfig(event).storage.provider;
    if (!store.getStorageGenerationCandidates || (storageProviderId !== 'fs' && storageProviderId !== 's3')) {
        return { available: false as const, reason: 'Managed-generation inspection is unavailable for this provider pairing. Legacy objects remain excluded.' };
    }
    try {
        const page = await store.getStorageGenerationCandidates({ workspaceId, storageProviderId, retentionSeconds: 7 * 86_400, limit: 25, cursor });
        let cleanupAvailable = false;
        try {
            const storage = getActiveStorageGatewayAdapter();
            requireExternalStorageGenerationPair(getActiveSyncGatewayAdapter(), storage);
            cleanupAvailable = typeof storage?.externalStorageGenerations?.reclaimBatch === 'function';
        } catch { /* Inspection remains available without qualified deletion. */ }
        return { available: true as const, page, cleanupAvailable };
    } catch {
        return { available: false as const, reason: 'Canonical generation proof is unavailable. Nothing was claimed, removed or released.' };
    }
});
