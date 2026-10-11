import { createError } from 'h3';
import type { ExternalStorageGenerationUploadCoordinatorV1 } from '../../storage/gateway/generation-upload';

const methods = [
    'registerVerifiedGeneration', 'getGeneration', 'claimGeneration', 'completeDeletion',
    'reserveGenerationUpload', 'reserveGenerationRestore', 'getGenerationUpload', 'markGenerationUploadReady',
    'publishGenerationUpload', 'claimAbandonedGenerationUpload', 'getGenerationUploadClaim',
    'completeGenerationUploadAbandonment', 'listGenerationUploadRecovery',
] as const;

function validProviderId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value === value.trim();
}

/** Qualification for explicitly constructed dormant factories. This performs
 * no registration, runtime selection or lifecycle operation. Passing it is not
 * authentication, authorization, verified upload evidence or cleanup consent.
 * The original generation trait alone never qualifies as upload coordination.
 */
export function requireExternalStorageGenerationUploadCoordinator(
    value: unknown,
    storageProviderId: string,
): ExternalStorageGenerationUploadCoordinatorV1 {
    const candidate = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : null;
    if (!candidate || candidate.version !== 1 || candidate.uploadVersion !== 1
        || !validProviderId(storageProviderId) || !validProviderId(candidate.storageProviderId)
        || candidate.storageProviderId !== storageProviderId
        || !methods.every(method => typeof candidate[method] === 'function')) {
        throw createError({ statusCode: 503, statusMessage: 'External storage generation upload coordination is unavailable' });
    }
    return candidate as unknown as ExternalStorageGenerationUploadCoordinatorV1;
}
