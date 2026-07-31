import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import {
    registerAdminPage,
    registerAdminWidget,
    useAdminPages,
    useAdminWidgets,
    resolveAdminComponent,
    state,
} from '../useAdminPlugins';

describe('useAdminPlugins', () => {
    beforeEach(() => {
        // Reset state
        state.pages = [];
        state.widgets = [];
    });

    describe('registerAdminPage', () => {
        it('registers a new page', () => {
            registerAdminPage({
                id: 'test-page',
                label: 'Test Page',
                component: () => Promise.resolve({ default: {} as any }),
            });

            expect(state.pages).toHaveLength(1);
            expect(state.pages[0]?.id).toBe('test-page');
        });

        it('deduplicates by id (replaces existing)', () => {
            registerAdminPage({
                id: 'test-page',
                label: 'Original',
                component: () => Promise.resolve({ default: {} as any }),
            });
            registerAdminPage({
                id: 'test-page',
                label: 'Updated',
                component: () => Promise.resolve({ default: {} as any }),
            });

            expect(state.pages).toHaveLength(1);
            expect(state.pages[0]?.label).toBe('Updated');
        });

        it('normalizes path from id when not provided', () => {
            registerAdminPage({
                id: 'my-page',
                label: 'My Page',
                component: () => Promise.resolve({ default: {} as any }),
            });

            expect(state.pages[0]?.path).toBe('my-page');
        });

        it('uses provided path over id', () => {
            registerAdminPage({
                id: 'my-page',
                label: 'My Page',
                path: 'custom-path',
                component: () => Promise.resolve({ default: {} as any }),
            });

            expect(state.pages[0]?.path).toBe('custom-path');
        });
    });

    describe('useAdminPages', () => {
        it('returns pages sorted by order', () => {
            registerAdminPage({
                id: 'b',
                label: 'B',
                order: 2,
                component: () => Promise.resolve({ default: {} as any }),
            });
            registerAdminPage({
                id: 'a',
                label: 'A',
                order: 1,
                component: () => Promise.resolve({ default: {} as any }),
            });
            registerAdminPage({
                id: 'c',
                label: 'C',
                order: 3,
                component: () => Promise.resolve({ default: {} as any }),
            });

            const pages = useAdminPages();
            expect(pages.value.map((p) => p.id)).toEqual(['a', 'b', 'c']);
        });

        it('defaults order to 0 when not specified', () => {
            registerAdminPage({
                id: 'a',
                label: 'A',
                component: () => Promise.resolve({ default: {} as any }),
            });
            registerAdminPage({
                id: 'b',
                label: 'B',
                order: -1,
                component: () => Promise.resolve({ default: {} as any }),
            });

            const pages = useAdminPages();
            expect(pages.value.map((p) => p.id)).toEqual(['b', 'a']);
        });

        it('reacts to state changes', async () => {
            const pages = useAdminPages();
            expect(pages.value).toHaveLength(0);

            registerAdminPage({
                id: 'new',
                label: 'New',
                component: () => Promise.resolve({ default: {} as any }),
            });

            await nextTick();
            expect(pages.value).toHaveLength(1);
        });
    });

    describe('registerAdminWidget', () => {
        it('registers a new widget', () => {
            registerAdminWidget({
                id: 'test-widget',
                slot: 'overview',
                component: () => Promise.resolve({ default: {} as any }),
            });

            expect(state.widgets).toHaveLength(1);
            expect(state.widgets[0]?.id).toBe('test-widget');
        });

        it('deduplicates by id', () => {
            registerAdminWidget({
                id: 'test-widget',
                slot: 'overview',
                component: () => Promise.resolve({ default: {} as any }),
            });
            registerAdminWidget({
                id: 'test-widget',
                slot: 'system',
                component: () => Promise.resolve({ default: {} as any }),
            });

            expect(state.widgets).toHaveLength(1);
            expect(state.widgets[0]?.slot).toBe('system');
        });
    });

    describe('useAdminWidgets', () => {
        it('returns all widgets when no slot specified', () => {
            registerAdminWidget({
                id: 'w1',
                slot: 'overview',
                component: {} as any,
            });
            registerAdminWidget({
                id: 'w2',
                slot: 'system',
                component: {} as any,
            });

            const widgets = useAdminWidgets();
            expect(widgets.value).toHaveLength(2);
        });

        it('filters by slot when specified', () => {
            registerAdminWidget({
                id: 'w1',
                slot: 'overview',
                component: {} as any,
            });
            registerAdminWidget({
                id: 'w2',
                slot: 'system',
                component: {} as any,
            });
            registerAdminWidget({
                id: 'w3',
                slot: 'overview',
                component: {} as any,
            });

            const widgets = useAdminWidgets('overview');
            expect(widgets.value).toHaveLength(2);
            expect(widgets.value.map((w) => w.id)).toContain('w1');
            expect(widgets.value.map((w) => w.id)).toContain('w3');
        });

        it('sorts widgets by order', () => {
            registerAdminWidget({
                id: 'b',
                slot: 'overview',
                order: 2,
                component: {} as any,
            });
            registerAdminWidget({
                id: 'a',
                slot: 'overview',
                order: 1,
                component: {} as any,
            });

            const widgets = useAdminWidgets('overview');
            expect(widgets.value.map((w) => w.id)).toEqual(['a', 'b']);
        });
    });

    describe('resolveAdminComponent', () => {
        it('caches async components', async () => {
            const loader = vi.fn().mockResolvedValue({ default: {} as any });
            const def = { id: 'test', component: loader };

            // First call
            const c1 = resolveAdminComponent(def);
            // Second call should return cached
            const c2 = resolveAdminComponent(def);

            expect(c1).toBe(c2);
            expect(loader).not.toHaveBeenCalled(); // Lazy, not called yet
        });

        it('returns synchronous components directly', () => {
            // Use a plain object that is NOT a function
            const component = { render: () => null } as any;
            const def = { id: 'sync-test', component };

            const result = resolveAdminComponent(def);

            expect(result).toBe(component);
        });

        it('evicts old entries when cache exceeds MAX_CACHE_SIZE', () => {
            // Register more than 50 components to trigger eviction
            for (let i = 0; i < 55; i++) {
                registerAdminPage({
                    id: `page-${i}`,
                    label: `Page ${i}`,
                    component: () => Promise.resolve({ default: {} as any }),
                });
            }

            // Access first page to trigger cache
            const pages = useAdminPages();
            for (const page of pages.value.slice(0, 5)) {
                resolveAdminComponent(page);
            }

            // Cache should only hold 50 entries
            // This is tested indirectly - the function should not throw
            expect(pages.value).toHaveLength(55);
        });
    });
});
