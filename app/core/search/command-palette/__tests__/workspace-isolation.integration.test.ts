import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetPaletteRegistryForTests,
    registerPaletteSource,
} from '../registry';
import { CORE_PALETTE_CATEGORIES, type PaletteResource } from '../types';

vi.mock('~/db/client', async () => {
    let generation = 1;
    let workspaceId: string | null = 'ws-a';
    const listeners = new Set<
        (event: {
            oldWorkspaceId: string | null;
            newWorkspaceId: string | null;
            generation: number;
        }) => void
    >();

    const dbs = new Map<string, { phrase: string }>();
    dbs.set('ws-a', { phrase: 'workspace-a-secret-phrase' });
    dbs.set('ws-b', { phrase: 'workspace-b-only' });

    return {
        getActiveWorkspaceId: () => workspaceId,
        getWorkspaceGeneration: () => generation,
        getDb: () => ({ workspaceId, ...(dbs.get(workspaceId ?? '') ?? {}) }),
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
        setActiveWorkspaceDb: (id: string | null) => {
            const old = workspaceId;
            if (old === id) return;
            generation += 1;
            workspaceId = id;
            for (const listener of listeners) {
                listener({
                    oldWorkspaceId: old,
                    newWorkspaceId: id,
                    generation,
                });
            }
        },
    };
});

vi.mock('~/core/search/orama', () => ({
    createDb: vi.fn(async () => ({ id: 'db' })),
    insertDocumentsBatched: vi.fn(async () => undefined),
    removeDoc: vi.fn(async () => undefined),
    searchWithIndex: vi.fn(async (_db, term: string) => {
        if (term.includes('workspace-a-secret-phrase')) {
            return {
                hits: [
                    {
                        score: 10,
                        document: {
                            id: '1',
                            resourceKey: 'chat:a',
                            recordId: 'a',
                            title: 'A',
                            subtitle: '',
                            keywords: '',
                            body: 'workspace-a-secret-phrase',
                            updatedAt: 1,
                            chunkIndex: 0,
                        },
                    },
                ],
            };
        }
        return { hits: [] };
    }),
}));

describe('palette workspace isolation', () => {
    beforeEach(() => {
        __resetPaletteRegistryForTests();
        vi.resetModules();
    });

    it('never publishes workspace A secrets after switching to B', async () => {
        const chatCategory = CORE_PALETTE_CATEGORIES.find((c) => c.id === 'chat')!;
        const deferred: { resolveA?: (value: PaletteResource[]) => void } = {};
        let loadCount = 0;

        registerPaletteSource({
            id: 'chat',
            label: 'Chats',
            category: chatCategory,
            order: 20,
            load: async (context) => {
                loadCount += 1;
                const db = (await context.getDb()) as {
                    phrase: string;
                    workspaceId: string | null;
                };
                if (db.workspaceId === 'ws-a' && loadCount === 1) {
                    return new Promise((resolve) => {
                        deferred.resolveA = resolve;
                    });
                }
                return [
                    {
                        key: `chat:${db.workspaceId}`,
                        sourceId: 'chat',
                        categoryId: 'chat',
                        recordId: db.workspaceId ?? 'x',
                        title: String(db.workspaceId),
                        content: db.phrase,
                        updatedAt: 1,
                        primaryAction: {
                            id: 'open',
                            label: 'Open',
                            target: {
                                kind: 'chat',
                                threadId: 'x',
                                destination: 'active',
                            },
                        },
                    },
                ];
            },
        });

        const client = await import('~/db/client');
        const { createPaletteCoordinator } = await import('../coordinator');
        const coordinator = createPaletteCoordinator({ debounceMs: 0 });
        const warmA = coordinator.ensureWarm();

        client.setActiveWorkspaceDb('ws-b');
        deferred.resolveA?.([
            {
                key: 'chat:a',
                sourceId: 'chat',
                categoryId: 'chat',
                recordId: 'a',
                title: 'Leaked',
                content: 'workspace-a-secret-phrase',
                updatedAt: 1,
                primaryAction: {
                    id: 'open',
                    label: 'Open',
                    target: {
                        kind: 'chat',
                        threadId: 'a',
                        destination: 'active',
                    },
                },
            },
        ]);
        await warmA;
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        coordinator.setQuery('workspace-a-secret-phrase');
        await new Promise((r) => setTimeout(r, 10));

        const snapshot = coordinator.getSnapshot();
        const leaked = snapshot.results.some(
            (result) =>
                result.key === 'chat:a' ||
                result.snippet?.includes('workspace-a-secret-phrase') ||
                result.title === 'Leaked'
        );
        expect(leaked).toBe(false);
        coordinator.dispose();
    });
});
