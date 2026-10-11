import { describe, expect, it, vi } from 'vitest';
import type { SyncGatewayAdapter } from '../../../sync/gateway/types';
import type { StorageGatewayAdapter } from '../../../storage/gateway/types';
import { requireExternalStorageGenerationPair } from '../generation-coordination';

// Failure modes: native deletion support is mistaken for external lifecycle
// support, one provider upgrades alone, IDs disagree, or a malformed provider
// advertises a capability without implementing its complete trusted-server API.
function pair() {
    const coordinator = {
        version: 1 as const,
        storageProviderId: 'fs',
        registerVerifiedGeneration: vi.fn(),
        getGeneration: vi.fn(),
        claimGeneration: vi.fn(),
        completeDeletion: vi.fn(),
    };
    const sync = {
        id: 'sqlite',
        capabilities: { externalStorageGenerations: 'v1' },
        storageGenerationCoordinator: coordinator,
    } as unknown as SyncGatewayAdapter;
    const storage = {
        id: 'fs',
        externalStorageGenerations: { version: 1, syncProviderId: 'sqlite' },
    } as StorageGatewayAdapter;
    return { sync, storage, coordinator };
}

describe('external generation pairing remains fail-closed', () => {
    it('does not accept absent or one-sided capabilities', () => {
        const { sync, storage } = pair();
        for (const [canonical, bytes] of [[null, storage], [sync, null],
            [{ ...sync, capabilities: {} }, storage],
            [sync, { ...storage, externalStorageGenerations: undefined }],
        ] as const) {
            expect(() => requireExternalStorageGenerationPair(canonical, bytes))
                .toThrowError(expect.objectContaining({ statusCode: 503 }));
        }
    });

    it('never treats native deletion coordination as external-generation support', () => {
        const { sync, storage } = pair();
        expect(() => requireExternalStorageGenerationPair(
            { ...sync, capabilities: { retainedStorageMetadata: 'v1' } },
            { ...storage, externalStorageGenerations: undefined, deletionCoordination: { version: 1, syncProviderId: 'sqlite' } },
        )).toThrowError(expect.objectContaining({ statusCode: 503 }));
    });

    it('rejects mismatched providers and missing methods', () => {
        const { sync, storage, coordinator } = pair();
        expect(() => requireExternalStorageGenerationPair(sync,
            { ...storage, externalStorageGenerations: { version: 1, syncProviderId: 'convex' } },
        )).toThrowError(expect.objectContaining({ statusCode: 503 }));
        expect(() => requireExternalStorageGenerationPair(
            { ...sync, storageGenerationCoordinator: { ...coordinator, storageProviderId: 's3' } }, storage,
        )).toThrowError(expect.objectContaining({ statusCode: 503 }));
        expect(() => requireExternalStorageGenerationPair(
            { ...sync, storageGenerationCoordinator: { ...coordinator, claimGeneration: undefined } } as unknown as SyncGatewayAdapter,
            storage,
        )).toThrowError(expect.objectContaining({ statusCode: 503 }));
    });

    it.each([undefined, null, '', '   ', 123])('rejects coincident malformed provider IDs (%s)', id => {
        const { sync, storage, coordinator } = pair();
        expect(() => requireExternalStorageGenerationPair(
            { ...sync, id, storageGenerationCoordinator: { ...coordinator, storageProviderId: id } } as unknown as SyncGatewayAdapter,
            { ...storage, id, externalStorageGenerations: { version: 1, syncProviderId: id } } as unknown as StorageGatewayAdapter,
        )).toThrowError(expect.objectContaining({ statusCode: 503 }));
    });

    it('resolves only an explicitly paired complete API, without performing work', () => {
        const { sync, storage, coordinator } = pair();
        expect(requireExternalStorageGenerationPair(sync, storage)).toBe(coordinator);
        expect(coordinator.registerVerifiedGeneration).not.toHaveBeenCalled();
        expect(coordinator.claimGeneration).not.toHaveBeenCalled();
        expect(coordinator.completeDeletion).not.toHaveBeenCalled();
    });
});
