import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetPaletteRegistryForTests,
    registerPaletteCommand,
    registerPaletteSource,
} from '../registry';
import { CORE_PALETTE_CATEGORIES, type PaletteResource } from '../types';
import { createDashboardPaletteSource } from '../sources/dashboard-source';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
} from '~/composables/dashboard/useDashboardPlugins';

vi.mock('~/db/client', () => {
    let generation = 1;
    const listeners = new Set<
        (event: {
            oldWorkspaceId: string | null;
            newWorkspaceId: string | null;
            generation: number;
        }) => void
    >();
    return {
        getActiveWorkspaceId: () => 'ws-a',
        getDb: () => ({}),
        getWorkspaceGeneration: () => generation,
        subscribeActiveWorkspaceDb: (
            listener: (event: {
                oldWorkspaceId: string | null;
                newWorkspaceId: string | null;
                generation: number;
            }) => void
        ) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        __testSwitchWorkspace: (id: string) => {
            generation += 1;
            for (const listener of listeners) {
                listener({
                    oldWorkspaceId: 'ws-a',
                    newWorkspaceId: id,
                    generation,
                });
            }
        },
        __testGetListeners: () => listeners,
        __testGetGeneration: () => generation,
    };
});

vi.mock('~/core/search/orama', () => ({
    createDb: vi.fn(async () => ({ id: 'db' })),
    insertDocumentsBatched: vi.fn(async () => undefined),
    removeDoc: vi.fn(async () => undefined),
    searchWithIndex: vi.fn(async (_db, term: string) => {
        if (term.includes('secret-a')) {
            return {
                hits: [
                    {
                        score: 10,
                        document: {
                            id: '1',
                            resourceKey: 'chat:1',
                            recordId: '1',
                            title: 'Thread',
                            subtitle: '',
                            keywords: '',
                            body: 'secret-a phrase',
                            updatedAt: 5,
                            chunkIndex: 0,
                        },
                    },
                ],
            };
        }
        return { hits: [] };
    }),
}));

function makeResource(
    overrides: Partial<PaletteResource> & { key: string; recordId: string }
): PaletteResource {
    return {
        sourceId: 'chat',
        categoryId: 'chat',
        title: 'Thread',
        content: '',
        updatedAt: 1,
        primaryAction: {
            id: 'open',
            label: 'Open',
            target: {
                kind: 'chat',
                threadId: overrides.recordId,
                destination: 'active',
            },
        },
        ...overrides,
    };
}

describe('createPaletteCoordinator', () => {
    beforeEach(() => {
        __resetPaletteRegistryForTests();
        unregisterDashboardPlugin('palette-live-dashboard');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fans out, caps results, and supports empty-query discovery', async () => {
        const chatCategory = CORE_PALETTE_CATEGORIES.find((c) => c.id === 'chat')!;
        registerPaletteCommand(
            { id: 'new-chat', label: 'New chat', order: 1 },
            () => ({ ok: true })
        );
        registerPaletteSource({
            id: 'chat',
            label: 'Chats',
            category: chatCategory,
            order: 20,
            load: async () => [
                makeResource({
                    key: 'chat:1',
                    recordId: '1',
                    content: 'secret-a phrase',
                    updatedAt: 10,
                }),
                makeResource({
                    key: 'chat:2',
                    recordId: '2',
                    content: 'other',
                    updatedAt: 9,
                }),
            ],
        });

        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 120 });
        await coordinator.ensureWarm();

        const empty = coordinator.getSnapshot();
        expect(empty.results[0]?.categoryId).toBe('command');
        expect(
            empty.results.some((r) => r.categoryId === 'chat')
        ).toBe(true);

        coordinator.setQuery('secret-a');
        await vi.advanceTimersByTimeAsync(120);
        // allow microtasks
        await Promise.resolve();
        const searched = coordinator.getSnapshot();
        expect(searched.results.some((r) => r.key === 'chat:1')).toBe(true);

        coordinator.setQuery('chat:');
        await vi.advanceTimersByTimeAsync(120);
        await Promise.resolve();
        const filtered = coordinator.getSnapshot();
        expect(filtered.parsedKind).toBe('category');
        expect(filtered.categoryId).toBe('chat');

        coordinator.dispose();
    });

    it('ignores late work after workspace switch', async () => {
        vi.useRealTimers();
        const chatCategory = CORE_PALETTE_CATEGORIES.find((c) => c.id === 'chat')!;
        let loadCount = 0;
        let firstSignal: AbortSignal | undefined;
        // Held in an object so TypeScript keeps the declared type across the
        // callback assignment below.
        const deferred: {
            resolveFirst?: (value: PaletteResource[]) => void;
        } = {};
        registerPaletteSource({
            id: 'chat',
            label: 'Chats',
            category: chatCategory,
            order: 20,
            load: (context) => {
                loadCount += 1;
                if (loadCount === 1) {
                    firstSignal = context.signal;
                    return new Promise((resolve) => {
                        deferred.resolveFirst = resolve;
                    });
                }
                return Promise.resolve([
                    makeResource({
                        key: 'chat:b',
                        recordId: 'b',
                        content: 'workspace b only',
                        title: 'B',
                    }),
                ]);
            },
        });

        const client = await import('~/db/client');
        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 0 });
        const warmPromise = coordinator.ensureWarm();

        (client as unknown as { __testSwitchWorkspace: (id: string) => void })
            .__testSwitchWorkspace('ws-b');
        expect(firstSignal?.aborted).toBe(true);

        // Late completion from workspace A must not publish leaked results.
        deferred.resolveFirst?.([
            makeResource({
                key: 'chat:leak',
                recordId: 'leak',
                content: 'secret-a should not leak',
                title: 'Leaked',
            }),
        ]);
        await warmPromise;
        // Second ensureWarm was kicked by the workspace listener.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(loadCount).toBeGreaterThanOrEqual(2);
        const snapshot = coordinator.getSnapshot();
        expect(
            snapshot.results.some((r) => r.key === 'chat:leak')
        ).toBe(false);
        coordinator.dispose();
    });

    it('reconciles existing source data and removes unregistered sources', async () => {
        vi.useRealTimers();
        const chatCategory = CORE_PALETTE_CATEGORIES.find((c) => c.id === 'chat')!;
        let current = [
            makeResource({
                key: 'chat:a',
                recordId: 'a',
                title: 'Before edit',
                updatedAt: 1,
            }),
        ];
        const handle = registerPaletteSource({
            id: 'chat',
            label: 'Chats',
            category: chatCategory,
            order: 20,
            load: async () => current,
        });

        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 0 });
        await coordinator.ensureWarm();
        expect(coordinator.getSnapshot().results[0]?.title).toBe('Before edit');

        current = [
            makeResource({
                key: 'chat:b',
                recordId: 'b',
                title: 'After edit',
                updatedAt: 2,
            }),
        ];
        await coordinator.ensureWarm();
        expect(coordinator.getSnapshot().results.map((item) => item.key)).toEqual([
            'chat:b',
        ]);

        handle.dispose();
        await coordinator.ensureWarm();
        expect(coordinator.getSnapshot().results).toEqual([]);
        coordinator.dispose();
    });

    it('refreshes an already-warm dashboard source when its registry changes', async () => {
        vi.useRealTimers();
        registerPaletteSource(createDashboardPaletteSource());
        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 0 });
        await coordinator.ensureWarm();
        expect(
            coordinator
                .getSnapshot()
                .results.some((item) => item.key === 'dashboard:palette-live-dashboard')
        ).toBe(false);

        const handle = registerDashboardPlugin({
            id: 'palette-live-dashboard',
            icon: 'i-lucide-test-tube',
            label: 'Live dashboard',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
            coordinator
                .getSnapshot()
                .results.some((item) => item.key === 'dashboard:palette-live-dashboard')
        ).toBe(true);

        handle.dispose();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
            coordinator
                .getSnapshot()
                .results.some((item) => item.key === 'dashboard:palette-live-dashboard')
        ).toBe(false);
        coordinator.dispose();
    });

    it('retries only the requested source', async () => {
        vi.useRealTimers();
        const chatCategory = CORE_PALETTE_CATEGORIES.find(
            (category) => category.id === 'chat'
        )!;
        const projectCategory = CORE_PALETTE_CATEGORIES.find(
            (category) => category.id === 'project'
        )!;
        let chatLoads = 0;
        let projectLoads = 0;
        registerPaletteSource({
            id: 'chat',
            label: 'Chats',
            category: chatCategory,
            order: 20,
            load: async () => {
                chatLoads += 1;
                return [];
            },
        });
        registerPaletteSource({
            id: 'project',
            label: 'Projects',
            category: projectCategory,
            order: 30,
            load: async () => {
                projectLoads += 1;
                return [];
            },
        });
        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 0 });
        await coordinator.ensureWarm();
        expect([chatLoads, projectLoads]).toEqual([1, 1]);

        await coordinator.retrySource('chat');
        expect([chatLoads, projectLoads]).toEqual([2, 1]);
        coordinator.dispose();
    });

    it('removes a source before loading or displaying a newly denied replacement', async () => {
        vi.useRealTimers();
        const chatCategory = CORE_PALETTE_CATEGORIES.find(
            (category) => category.id === 'chat'
        )!;
        registerPaletteSource({
            id: 'plugin-search',
            label: 'Plugin search',
            category: chatCategory,
            order: 25,
            pluginId: 'plugin-search-owner',
            load: async () => [
                makeResource({
                    key: 'plugin-search:secret',
                    sourceId: 'plugin-search',
                    recordId: 'secret',
                    title: 'Visible before revoke',
                }),
            ],
        });
        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 0 });
        await coordinator.ensureWarm();
        expect(
            coordinator
                .getSnapshot()
                .results.some((item) => item.key === 'plugin-search:secret')
        ).toBe(true);

        const deniedLoad = vi.fn(async () => []);
        registerPaletteSource({
            id: 'plugin-search',
            label: 'Plugin search',
            category: chatCategory,
            order: 25,
            pluginId: 'plugin-search-owner',
            access: { requiredEntitlements: ['revoked-palette-access'] },
            load: deniedLoad,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(deniedLoad).not.toHaveBeenCalled();
        expect(
            coordinator
                .getSnapshot()
                .results.some((item) => item.key === 'plugin-search:secret')
        ).toBe(false);
        coordinator.dispose();
    });
});
