import { createError } from 'h3';
import type { SyncGatewayAdapter } from '../../sync/gateway/types';
import type { StorageGatewayAdapter } from '../../storage/gateway/types';
import type { ExternalStorageGenerationCoordinatorV1 } from '../../storage/gateway/generation-lifecycle';

function validProviderId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** Pure pairing guard for future authenticated lifecycle dispatch. No existing
 * route calls it and no provider advertises these flags. Passing this guard is
 * not authorization, byte verification, or permission to activate cleanup.
 */
export function requireExternalStorageGenerationPair(
    sync: SyncGatewayAdapter | null,
    storage: StorageGatewayAdapter | null,
): ExternalStorageGenerationCoordinatorV1 {
    const coordinator = sync?.storageGenerationCoordinator;
    const storageCapability = storage?.externalStorageGenerations;
    const methods = ['registerVerifiedGeneration', 'getGeneration', 'claimGeneration', 'completeDeletion'] as const;
    if (!sync || !storage || !validProviderId(sync.id) || !validProviderId(storage.id)
        || !validProviderId(storageCapability?.syncProviderId) || !validProviderId(coordinator?.storageProviderId)
        || sync.capabilities?.externalStorageGenerations !== 'v1'
        || storageCapability?.version !== 1 || storageCapability.syncProviderId !== sync.id
        || coordinator?.version !== 1 || coordinator.storageProviderId !== storage.id
        || !methods.every(method => typeof coordinator[method] === 'function')) {
        throw createError({ statusCode: 503, statusMessage: 'External storage generation coordination is unavailable' });
    }
    return coordinator;
}
