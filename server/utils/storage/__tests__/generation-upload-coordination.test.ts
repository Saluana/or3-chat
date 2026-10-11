import { describe, expect, it, vi } from 'vitest';
import { requireExternalStorageGenerationUploadCoordinator } from '../generation-upload-coordination';

const methods = [
    'registerVerifiedGeneration', 'getGeneration', 'claimGeneration', 'completeDeletion',
    'reserveGenerationUpload', 'reserveGenerationRestore', 'getGenerationUpload', 'markGenerationUploadReady',
    'publishGenerationUpload', 'claimAbandonedGenerationUpload', 'getGenerationUploadClaim',
    'completeGenerationUploadAbandonment', 'listGenerationUploadRecovery',
] as const;

function coordinator() {
    return {
        version: 1, uploadVersion: 1, storageProviderId: 'fs',
        ...Object.fromEntries(methods.map(method => [method, vi.fn()])),
    };
}

describe('dormant upload coordinator qualification', () => {
    it.each([undefined, null, false, {}, { version: 1 }])('rejects absent/unqualified input %s', value => {
        expect(() => requireExternalStorageGenerationUploadCoordinator(value, 'fs')).toThrow();
    });

    it('does not treat original generation v1 as an upload contract', () => {
        expect(() => requireExternalStorageGenerationUploadCoordinator({ ...coordinator(), uploadVersion: undefined }, 'fs'))
            .toThrow(expect.objectContaining({ statusCode: 503 }));
    });

    it.each(methods)('requires callable %s without invoking it', method => {
        const value = coordinator();
        expect(() => requireExternalStorageGenerationUploadCoordinator({ ...value, [method]: undefined }, 'fs')).toThrow();
        for (const fn of Object.values(value)) if (typeof fn === 'function') expect(fn).not.toHaveBeenCalled();
    });

    it.each(['', ' ', ' fs', 'fs ', undefined, null, 1])('refuses malformed or noncanonical provider identity %s', id => {
        expect(() => requireExternalStorageGenerationUploadCoordinator({ ...coordinator(), storageProviderId: id }, id as string)).toThrow();
    });

    it('rejects a different provider or protocol version', () => {
        expect(() => requireExternalStorageGenerationUploadCoordinator(coordinator(), 'convex')).toThrow();
        expect(() => requireExternalStorageGenerationUploadCoordinator({ ...coordinator(), version: 2 }, 'fs')).toThrow();
        expect(() => requireExternalStorageGenerationUploadCoordinator({ ...coordinator(), uploadVersion: 2 }, 'fs')).toThrow();
    });

    it('returns only the explicit complete trait without performing operations', () => {
        const value = coordinator();
        expect(requireExternalStorageGenerationUploadCoordinator(value, 'fs')).toBe(value);
        for (const fn of Object.values(value)) if (typeof fn === 'function') expect(fn).not.toHaveBeenCalled();
    });
});
