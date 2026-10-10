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

    // Failure modes: moving pages, repeated cursors, malformed provider data,
    // aliases, reservation identity conflicts, and arithmetic overflow.
    it('rejects a repeated cursor instead of looping indefinitely', async () => {
        const queryCanonicalStorage = vi.fn()
            .mockResolvedValueOnce({ items: [], hasMore: true, nextCursor: 'same' })
            .mockResolvedValueOnce({ items: [], hasMore: true, nextCursor: 'same' })
            .mockRejectedValue(new Error('Fixture abort: unsafe traversal'));
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
        expect(queryCanonicalStorage).toHaveBeenCalledTimes(2);
    });

    it('counts normalized hashes once and ignores a stale cursor on the final page', async () => {
        const queryCanonicalStorage = vi.fn()
            .mockResolvedValueOnce({ items: [
                { kind: 'metadata', hash: 'a'.repeat(64), sizeBytes: 12 },
                { kind: 'metadata', hash: 'sha256:' + 'a'.repeat(64), sizeBytes: 12 },
            ], hasMore: false, nextCursor: 'stale' })
            .mockResolvedValueOnce({ items: [], hasMore: false });
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).resolves.toMatchObject({ usedBytes: 12, reservedBytes: 0 });
        expect(queryCanonicalStorage).toHaveBeenCalledTimes(2);
    });

    it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid byte counts (%s)', async sizeBytes => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn().mockResolvedValue({
            items: [{ kind: 'metadata', hash: 'a'.repeat(64), sizeBytes }], hasMore: false,
        }) });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it('rejects conflicting metadata for the same normalized object', async () => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn().mockResolvedValue({
            items: [12, 13].map(sizeBytes => ({ kind: 'metadata', hash: 'a'.repeat(64), sizeBytes })), hasMore: false,
        }) });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it.each([null, { items: [null], hasMore: false }, { items: [], hasMore: true, nextCursor: 123 },
        { items: [], hasMore: true }, { items: [], hasMore: 'false' },
        { items: [{ kind: 'reference', hash: 'a'.repeat(64) }], hasMore: false },
        { items: Array(501).fill({ kind: 'metadata', hash: 'a'.repeat(64), sizeBytes: 0 }), hasMore: false },
    ])('rejects malformed provider responses (%j)', async page => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn().mockResolvedValue(page) });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it.each(['', 'sha256:not-a-hash', 'sha256:' + 'a'.repeat(32), 123])('rejects malformed metadata hash (%s)', async hash => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn().mockResolvedValue({
            items: [{ kind: 'metadata', hash, sizeBytes: 1 }], hasMore: false,
        }) });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it('rejects conflicting reservation identities even when their sizes match', async () => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn()
            .mockResolvedValueOnce({ items: [], hasMore: false })
            .mockResolvedValueOnce({ items: ['a', 'b'].map(char => ({ kind: 'reservation', reservationId: 'same', hash: char.repeat(64), sizeBytes: 12 })), hasMore: false }),
        });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it('counts duplicate reservation pages once and pins query time', async () => {
        const reservation = { kind: 'reservation', reservationId: 'same', hash: 'a'.repeat(64), sizeBytes: 12 };
        const queryCanonicalStorage = vi.fn()
            .mockResolvedValueOnce({ items: [], hasMore: false })
            .mockResolvedValueOnce({ items: [reservation], hasMore: true, nextCursor: 'next' })
            .mockResolvedValueOnce({ items: [reservation], hasMore: false });
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).resolves.toMatchObject({ usedBytes: 0, reservedBytes: 12 });
        expect(new Set(queryCanonicalStorage.mock.calls.map(([, input]) => input.now)).size).toBe(1);
    });

    it('rejects overflow across committed and reserved totals', async () => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn()
            .mockResolvedValueOnce({ items: [{ kind: 'metadata', hash: 'a'.repeat(64), sizeBytes: Number.MAX_SAFE_INTEGER }], hasMore: false })
            .mockResolvedValueOnce({ items: [{ kind: 'reservation', reservationId: 'r', hash: 'b'.repeat(64), sizeBytes: 1 }], hasMore: false }),
        });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it('bounds a provider that returns endless unique cursors', async () => {
        let cursor = 0;
        const queryCanonicalStorage = vi.fn(async () => ({ items: [], hasMore: true, nextCursor: String(++cursor) }));
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        await expect(getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1')).rejects.toMatchObject({ statusCode: 502 });
        expect(queryCanonicalStorage).toHaveBeenCalledTimes(1000);
    });

    it('keeps legacy MD5 accounting and zero-byte files valid', async () => {
        getActiveSyncGatewayAdapterMock.mockReturnValue({ queryCanonicalStorage: vi.fn()
            .mockResolvedValueOnce({ items: [{ kind: 'metadata', hash: 'md5:' + 'a'.repeat(32), sizeBytes: 0 }], hasMore: false })
            .mockResolvedValueOnce({ items: [], hasMore: false }),
        });
        const { getWorkspaceStorageUsageSnapshot } = await import('../quota');
        const result = await getWorkspaceStorageUsageSnapshot({} as H3Event, 'ws-1');
        expect(result.filesByHash.get('a'.repeat(32))).toBe(0);
    });
});
