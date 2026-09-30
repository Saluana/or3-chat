import { describe, it, expect, beforeEach } from 'vitest';

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

    it('hides private plugin post types from the generic list surface', async () => {
        const { usePostsList } = await import('../usePostsList');
        const { items, loading, error } = usePostsList('or3:plugin-private:or3-tactics:revision');

        expect(items.value).toEqual([]);
        expect(loading.value).toBe(false);
        expect(error.value).toBeNull();
    });

});
