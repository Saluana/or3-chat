import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';

describe('usePostsList', () => {
    beforeEach(() => {
        // Mock process.client
        (global as any).process = { client: true };
    });

    it('should return SSR-safe empty state when not on client', () => {
        (global as any).process = { client: false };

        // Dynamic import to ensure fresh module
        return import('../usePostsList').then((mod) => {
            const { usePostsList } = mod;
            const { items, loading, error } = usePostsList('test-type');

            expect(items.value).toEqual([]);
            expect(loading.value).toBe(false);
            expect(error.value).toBeNull();
        });
    });

    it('should initialize with correct default options', async () => {
        // This test verifies the composable structure
        const { usePostsList } = await import('../usePostsList');

        // On client, it should return reactive refs
        const result = usePostsList('test-type');

        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('loading');
        expect(result).toHaveProperty('error');
        expect(result).toHaveProperty('refresh');
        expect(typeof result.refresh).toBe('function');
    });

    it('should accept options with limit and sort parameters', async () => {
        const { usePostsList } = await import('../usePostsList');

        // Should not throw with various option combinations
        expect(() => usePostsList('test', { limit: 10 })).not.toThrow();
        expect(() =>
            usePostsList('test', { sort: 'created_at' })
        ).not.toThrow();
        expect(() => usePostsList('test', { sortDir: 'asc' })).not.toThrow();
        expect(() =>
            usePostsList('test', {
                limit: 5,
                sort: 'updated_at',
                sortDir: 'desc',
            })
        ).not.toThrow();
    });
});
