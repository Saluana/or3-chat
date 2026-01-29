import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock Orama helpers
vi.mock('~/core/search/orama', () => ({
    createDb: vi.fn(() => Promise.resolve({ id: 'mock-db' })),
    buildIndex: vi.fn(() => Promise.resolve({ id: 'mock-db' })),
    searchWithIndex: vi.fn(() => Promise.resolve({ hits: [] })),
    insertDoc: vi.fn(() => Promise.resolve()),
    removeDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
}));

describe('useThreadSearch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('uses incremental updates instead of full rebuild', async () => {
        const { useThreadSearch } = await import('../useThreadSearch');
        const { createDb, buildIndex, insertDoc, removeDoc, updateDoc } = await import('~/core/search/orama');

        const threads = ref([{ id: '1', title: 't1', updated_at: 100 }]);
        const { rebuild } = useThreadSearch(threads as any);

        // Initial build
        await rebuild();
        expect(createDb).toHaveBeenCalledTimes(1);
        expect(buildIndex).toHaveBeenCalledTimes(1);

        // Add a thread
        threads.value = [
            { id: '1', title: 't1', updated_at: 100 },
            { id: '2', title: 't2', updated_at: 200 }
        ];

        await rebuild();

        // Should NOT call createDb again
        expect(createDb).toHaveBeenCalledTimes(1);
        // Should call insertDoc for the new thread
        expect(insertDoc).toHaveBeenCalledTimes(1);
        expect(insertDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: '2' }));

        // Update a thread
        threads.value = [
            { id: '1', title: 't1 changed', updated_at: 105 },
            { id: '2', title: 't2', updated_at: 200 }
        ];

        await rebuild();
        expect(createDb).toHaveBeenCalledTimes(1);
        expect(updateDoc).toHaveBeenCalledTimes(1);
        expect(updateDoc).toHaveBeenCalledWith(expect.anything(), '1', expect.objectContaining({ title: 't1 changed' }));

        // Remove a thread
        threads.value = [
            { id: '2', title: 't2', updated_at: 200 }
        ];

        await rebuild();
        expect(createDb).toHaveBeenCalledTimes(1);
        expect(removeDoc).toHaveBeenCalledTimes(1);
        expect(removeDoc).toHaveBeenCalledWith(expect.anything(), '1');
    });
});
