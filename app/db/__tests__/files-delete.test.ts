import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    metaDelete: vi.fn(),
    metaBulkDelete: vi.fn(),
    metaBulkGet: vi.fn(),
    blobDelete: vi.fn(),
    blobBulkDelete: vi.fn(),
    doAction: vi.fn(),
}));

vi.mock('../client', () => ({
    db: {
        file_meta: {
            delete: mocks.metaDelete,
            bulkDelete: mocks.metaBulkDelete,
            bulkGet: mocks.metaBulkGet,
        },
        file_blobs: {
            delete: mocks.blobDelete,
            bulkDelete: mocks.blobBulkDelete,
        },
        transaction: vi.fn(async (_mode, _tables, ...args) => {
             // callback is the last argument usually, but Dexie transaction signature:
             // transaction(mode, tables, callback)
             const callback = args[args.length - 1];
             await callback();
        }),
    },
}));

vi.mock('#app', () => ({
    useNuxtApp: () => ({}),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: mocks.doAction,
    }),
}));

vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn(),
}));

vi.mock('../util', () => ({
    nowSec: () => 1000,
    parseOrThrow: (_schema: any, val: any) => val,
}));

// We need to mock createDeletePayload because it might have schema validation
// But `hardDeleteMany` imports `createFileDeletePayload` from inside the same file (local function)
// No, it's defined in the file. So we rely on `parseOrThrow` mock.

import { hardDeleteMany } from '../files';

describe('hardDeleteMany', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.metaBulkGet.mockResolvedValue([]);
    });

    it('executes 1 bulk query per table (Optimized)', async () => {
        const hashes = ['h1', 'h2', 'h3'];
        mocks.metaBulkGet.mockResolvedValue(hashes.map(h => ({ hash: h })));

        await hardDeleteMany(hashes);

        // Optimized behavior:
        // No individual deletes
        expect(mocks.metaDelete).not.toHaveBeenCalled();
        expect(mocks.blobDelete).not.toHaveBeenCalled();

        // 1 bulk delete per table
        expect(mocks.metaBulkDelete).toHaveBeenCalledTimes(1);
        expect(mocks.blobBulkDelete).toHaveBeenCalledTimes(1);

        // Verify args
        expect(mocks.metaBulkDelete).toHaveBeenCalledWith(hashes);
        expect(mocks.blobBulkDelete).toHaveBeenCalledWith(hashes);

        // Hooks: before and after for each = 3 * 2 = 6
        expect(mocks.doAction).toHaveBeenCalledTimes(6);
    });
});
