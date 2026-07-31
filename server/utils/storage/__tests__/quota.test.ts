import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const getActiveSyncGatewayAdapterMock = vi.fn();

vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: getActiveSyncGatewayAdapterMock,
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return {
        ...actual,
        createError: (input: { statusCode: number; statusMessage: string }) =>
            Object.assign(new Error(input.statusMessage), input),
    };
});

describe('getWorkspaceStorageUsageSnapshot', () => {
    beforeEach(() => {
        vi.resetModules();
        getActiveSyncGatewayAdapterMock.mockReset();
    });

    it('sums bounded canonical metadata and active reservations without reading retained logs', async () => {
        const pull = vi.fn();
        const queryCanonicalStorage = vi
            .fn()
            .mockResolvedValueOnce({
                items: [{ kind: 'metadata', hash: `sha256:${'a'.repeat(64)}`, sizeBytes: 12, updatedAt: 1 }],
                hasMore: true,
                nextCursor: 'metadata-page-2',
            })
            .mockResolvedValueOnce({
                items: [{ kind: 'metadata', hash: `sha256:${'b'.repeat(64)}`, sizeBytes: 30, updatedAt: 2 }],
                hasMore: false,
            })
            .mockResolvedValueOnce({
                items: [{
                    kind: 'reservation',
                    reservationId: 'reservation-1',
                    hash: 'c'.repeat(64),
                    sizeBytes: 8,
                    expiresAt: 9999999999,
                }],
                hasMore: false,
            });
        getActiveSyncGatewayAdapterMock.mockReturnValue({ pull, queryCanonicalStorage });

        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        const result = await getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1');

        expect(result.usedBytes).toBe(42);
        expect(result.reservedBytes).toBe(8);
        expect([...result.filesByHash.entries()]).toEqual([
            ['a'.repeat(64), 12],
            ['b'.repeat(64), 30],
        ]);
        expect(queryCanonicalStorage).toHaveBeenCalledTimes(3);
        expect(pull).not.toHaveBeenCalled();
    });

    it('fails closed when the provider has no canonical storage query', async () => {
        const pull = vi.fn();
        getActiveSyncGatewayAdapterMock.mockReturnValue({ pull });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');

        await expect(
            getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')
        ).rejects.toMatchObject({ statusCode: 503 });
        expect(pull).not.toHaveBeenCalled();
    });
});
