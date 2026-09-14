import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import type { FileMeta } from '~/db/schema';
import type { ImageSummary } from '~/db/files-select';

interface LiveEntry {
    fn: () => Promise<unknown>;
    next: (value: unknown) => void;
    error: (error: unknown) => void;
    unsubscribed: boolean;
}

const state = vi.hoisted(() => ({
    generation: 0,
    workspaceListeners: [] as Array<() => void>,
    live: [] as Array<{
        fn: () => Promise<unknown>;
        next: (value: unknown) => void;
        error: (error: unknown) => void;
        unsubscribed: boolean;
    }>,
    summaries: [] as unknown[],
    summariesGate: null as Promise<void> | null,
    summariesError: null as unknown,
    references: [] as string[],
    referencesGate: null as Promise<void> | null,
    referencesError: null as unknown,
    pages: new Map<string, { items: unknown[]; hasMore: boolean; nextCursor: unknown; missing: number }>(),
    pool: [] as unknown[],
    dropNextHydration: null as string | null,
    hydrations: [] as string[][],
    pageError: null as unknown,
    pageCalls: [] as unknown[],
}));

vi.mock('dexie', () => ({
    liveQuery: (fn: () => Promise<unknown>) => ({
        subscribe(handlers: {
            next: (value: unknown) => void;
            error: (error: unknown) => void;
        }) {
            const entry: LiveEntry = {
                fn,
                next: handlers.next,
                error: handlers.error,
                unsubscribed: false,
            };
            state.live.push(entry);
            void fn().then(
                (value) => {
                    if (!entry.unsubscribed) entry.next(value);
                },
                (error) => {
                    if (!entry.unsubscribed) entry.error(error);
                }
            );
            return {
                unsubscribe() {
                    entry.unsubscribed = true;
                },
            };
        },
    }),
}));

vi.mock('~/db/client', () => ({
    getWorkspaceGeneration: () => state.generation,
    subscribeActiveWorkspaceDb: (listener: () => void) => {
        state.workspaceListeners.push(listener);
        return () => {
            state.workspaceListeners = state.workspaceListeners.filter(
                (entry) => entry !== listener
            );
        };
    },
}));

vi.mock('~/db/documents', () => ({
    listDocumentFileHashes: async () => {
        if (state.referencesGate) await state.referencesGate;
        if (state.referencesError) throw state.referencesError;
        return state.references;
    },
}));

vi.mock('~/db/files-select', () => ({
    listImageSummaries: async () => {
        if (state.summariesGate) await state.summariesGate;
        if (state.summariesError) throw state.summariesError;
        return state.summaries;
    },
    listImagePage: async (input: {
        state: string;
        sort: string;
        cursor: { last: [number, string] } | null;
    }) => {
        state.pageCalls.push(input);
        if (state.pageError) throw state.pageError;
        const key = input.cursor ? String(input.cursor.last[1]) : 'start';
        return (
            state.pages.get(key) ?? {
                items: [],
                hasMore: false,
                nextCursor: null,
                missing: 0,
            }
        );
    },
    getImageMetasByHashes: async (hashes: readonly string[]) => {
        if (state.pageError) throw state.pageError;
        state.hydrations.push([...hashes]);
        if (state.dropNextHydration) {
            const drop = state.dropNextHydration;
            state.dropNextHydration = null;
            state.pool = (state.pool as FileMeta[]).filter(
                (item) => item.hash !== drop
            );
        }
        const all =
            state.pool.length > 0
                ? state.pool
                : [...state.pages.values()].flatMap((page) => page.items);
        return hashes
            .map((hash) =>
                (all as FileMeta[]).find((item) => item.hash === hash)
            )
            .filter((item): item is FileMeta => Boolean(item));
    },
    // Re-exported types are erased at runtime.
}));

vi.mock('~/core/search/orama', () => ({
    createDb: vi.fn(async () => ({ id: 'fake' })),
    buildIndex: vi.fn(async () => undefined),
    searchWithIndex: vi.fn(async () => ({ hits: [] })),
}));

import { useImageGallery } from '../useImageGallery';

function summary(hash: string, name = `${hash}.png`): ImageSummary {
    return {
        hash,
        name,
        mime_type: 'image/png',
        created_at: 1,
        size_bytes: 1,
        state: 'active',
    };
}

function image(hash: string): FileMeta {
    return {
        hash,
        name: `${hash}.png`,
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 1,
        ref_count: 0,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 1,
    } as FileMeta;
}

async function flush(): Promise<void> {
    for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
    }
    await nextTick();
}

async function waitFor(
    condition: () => boolean,
    message = 'condition',
    timeout = 3000
): Promise<void> {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeout) {
            throw new Error(`Timed out waiting for ${message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function emitLive(index: number): Promise<void> {
    const entry = state.live[index];
    if (!entry) throw new Error(`Missing live subscription ${index}`);
    const value = await entry.fn();
    entry.next(value);
    await flush();
}

describe('useImageGallery controller states', () => {
    let scope: EffectScope;

    beforeEach(() => {
        state.generation = 0;
        state.workspaceListeners = [];
        state.live = [];
        state.summaries = [];
        state.summariesGate = null;
        state.summariesError = null;
        state.references = [];
        state.referencesGate = null;
        state.referencesError = null;
        state.pages = new Map();
        state.pool = [];
        state.dropNextHydration = null;
        state.hydrations = [];
        state.pageError = null;
        state.pageCalls = [];
        scope = effectScope();
    });

    afterEach(() => {
        scope.stop();
    });

    it('does not block the first page on pending aggregates and search', async () => {
        let releaseSummaries: () => void = () => undefined;
        state.summariesGate = new Promise<void>((resolve) => {
            releaseSummaries = resolve;
        });
        let releaseReferences: () => void = () => undefined;
        state.referencesGate = new Promise<void>((resolve) => {
            releaseReferences = resolve;
        });
        state.pages.set('start', {
            items: [image('h1')],
            hasMore: true,
            nextCursor: { state: 'active', sort: 'newest', last: [1, 'h1'] },
            missing: 0,
        });
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();
        expect(gallery.items.value.map((item) => item.hash)).toEqual(['h1']);
        expect(gallery.loading.value).toBe(false);
        expect(gallery.counts.value.all).toBeNull();
        expect(gallery.matchingTotal.value).toBeNull();

        releaseSummaries();
        releaseReferences();
        await flush();
        await flush();
        expect(gallery.counts.value.all).toBe(0);
    });

    it('reports page failures and recovers on retry', async () => {
        state.pageError = new Error('page failed');
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();
        expect(gallery.pageError.value).toBeInstanceOf(Error);
        expect(gallery.items.value).toEqual([]);

        state.pageError = null;
        state.pages.set('start', {
            items: [image('h1')],
            hasMore: false,
            nextCursor: null,
            missing: 0,
        });
        gallery.retry();
        await flush();
        await flush();
        expect(gallery.pageError.value).toBeNull();
        expect(gallery.items.value.map((item) => item.hash)).toEqual(['h1']);
    });

    it('surfaces aggregate failure instead of a zero count', async () => {
        state.summariesError = new Error('summaries failed');
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();
        expect(gallery.countsFailed.value).toBe(true);
        expect(gallery.counts.value.all).toBeNull();

        state.summariesError = null;
        state.summaries = [summary('h1')];
        gallery.retry();
        await flush();
        await flush();
        expect(gallery.countsFailed.value).toBe(false);
        expect(gallery.counts.value.all).toBe(1);
    });

    it('surfaces reference failure in the used-in-docs view instead of an empty list', async () => {
        state.referencesError = new Error('references failed');
        state.summaries = [summary('h1')];
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();
        gallery.activeView.value = 'used-in-docs';
        await flush();
        expect(gallery.pageError.value).toBeInstanceOf(Error);

        state.referencesError = null;
        state.references = ['h1'];
        state.pages.set('start', {
            items: [image('h1')],
            hasMore: false,
            nextCursor: null,
            missing: 0,
        });
        gallery.retry();
        await flush();
        await flush();
        expect(gallery.pageError.value).toBeNull();
        expect(gallery.items.value.map((item) => item.hash)).toEqual(['h1']);
    });

    it('disposes subscriptions and workspace listeners on stop', async () => {
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();
        expect(state.live).toHaveLength(2);
        expect(state.workspaceListeners).toHaveLength(1);

        gallery.stop();
        await flush();
        expect(state.live.every((entry) => entry.unsubscribed)).toBe(true);
        expect(state.workspaceListeners).toHaveLength(0);
    });

    it('clears waiting state and enables retry when a required aggregate fails', async () => {
        let rejectSummaries: (error: unknown) => void = () => undefined;
        state.summariesGate = new Promise<void>((_resolve, reject) => {
            rejectSummaries = reject;
        });
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();

        gallery.activeView.value = 'generated';
        await flush();
        expect(gallery.loading.value).toBe(true);
        expect(gallery.pageError.value).toBeNull();

        rejectSummaries(new Error('summaries failed'));
        await flush();
        await flush();
        expect(gallery.loading.value).toBe(false);
        expect(gallery.pageError.value).toBeInstanceOf(Error);
        expect(gallery.countsFailed.value).toBe(true);

        state.summariesGate = null;
        state.summaries = [summary('h1', 'gen-image-1.png')];
        state.pages.set('start', {
            items: [image('h1')],
            hasMore: false,
            nextCursor: null,
            missing: 0,
        });
        gallery.retry();
        await waitFor(
            () =>
                gallery.items.value.length === 1 && !gallery.loading.value,
            'retry page'
        );
        expect(gallery.pageError.value).toBeNull();
        expect(gallery.items.value.map((item) => item.hash)).toEqual(['h1']);
    });

    it('waits for summaries before name-sorted pages', async () => {
        let releaseSummaries: () => void = () => undefined;
        state.summariesGate = new Promise<void>((resolve) => {
            releaseSummaries = resolve;
        });
        state.pool = [image('h1')];
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();

        gallery.sortMode.value = 'name-asc';
        await flush();
        expect(gallery.loading.value).toBe(true);
        expect(gallery.items.value).toEqual([]);

        state.summaries = [summary('h1', 'a.png')];
        releaseSummaries();
        await waitFor(
            () => gallery.items.value.map((item) => item.hash).join() === 'h1',
            'name page'
        );
    });

    it('refreshes the entire loaded name-sorted window', async () => {
        state.summaries = Array.from({ length: 120 }, (_, index) =>
            summary(`h${index}`, `image-${String(index).padStart(3, '0')}.png`)
        );
        state.pool = Array.from({ length: 120 }, (_, index) =>
            image(`h${index}`)
        );
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await flush();
        gallery.sortMode.value = 'name-asc';
        await waitFor(
            () => gallery.items.value.length === 50 && !gallery.loading.value,
            'name page one'
        );

        gallery.loadMore();
        await waitFor(
            () => gallery.items.value.length === 100 && !gallery.loading.value,
            'name page two'
        );
        gallery.loadMore();
        await waitFor(
            () => gallery.items.value.length === 120 && !gallery.loading.value,
            'name page three'
        );
        expect(gallery.done.value).toBe(true);

        const hydrationsBefore = state.hydrations.length;
        gallery.refresh();
        await waitFor(
            () =>
                state.hydrations.length > hydrationsBefore &&
                !gallery.loading.value,
            'name refresh'
        );
        expect(gallery.items.value).toHaveLength(120);
    });

    it('keeps name offsets consistent when hydration loses a row', async () => {
        state.summaries = Array.from({ length: 5 }, (_, index) =>
            summary(`h${index}`, `image-${index}.png`)
        );
        state.pool = Array.from({ length: 5 }, (_, index) => image(`h${index}`));
        state.dropNextHydration = 'h1';

        const gallery = scope.run(() => useImageGallery({ pageSize: 3 }))!;
        gallery.start();
        await flush();
        gallery.sortMode.value = 'name-asc';
        await waitFor(
            () => gallery.items.value.length === 3 && !gallery.loading.value,
            'first name page'
        );
        expect(gallery.items.value.map((item) => item.hash)).toEqual([
            'h0',
            'h2',
            'h3',
        ]);

        gallery.loadMore();
        await waitFor(
            () => gallery.items.value.length === 4 && !gallery.loading.value,
            'second name page'
        );
        expect(gallery.items.value.map((item) => item.hash)).toEqual([
            'h0',
            'h2',
            'h3',
            'h4',
        ]);
        expect(gallery.done.value).toBe(true);
    });

    it('coalesces aggregate completion with page invalidation', async () => {
        let releaseSummaries: () => void = () => undefined;
        state.summariesGate = new Promise<void>((resolve) => {
            releaseSummaries = resolve;
        });
        let releaseReferences: () => void = () => undefined;
        state.referencesGate = new Promise<void>((resolve) => {
            releaseReferences = resolve;
        });
        state.summaries = [summary('h1')];
        state.references = ['h1'];
        state.pages.set('start', {
            items: [image('h1')],
            hasMore: false,
            nextCursor: null,
            missing: 0,
        });
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await waitFor(
            () => gallery.items.value.length === 1 && !gallery.loading.value,
            'first page'
        );
        expect(state.pageCalls).toHaveLength(1);

        // Initial summaries completion updates counts without refetching an
        // unfiltered page.
        releaseSummaries();
        await waitFor(() => gallery.counts.value.all === 1, 'counts');
        await flush();
        expect(state.pageCalls).toHaveLength(1);

        // Reference completion in "All images" does not affect its pages.
        releaseReferences();
        await waitFor(() => gallery.counts.value['used-in-docs'] === 1, 'used');
        await flush();
        expect(state.pageCalls).toHaveLength(1);

        // Reference changes do refresh the used-in-docs view.
        gallery.activeView.value = 'used-in-docs';
        await waitFor(() => gallery.items.value.length === 1, 'used view');
        const callsBefore = state.pageCalls.length;
        await emitLive(1);
        await waitFor(
            () => state.pageCalls.length > callsBefore,
            'reference refresh'
        );
    });

    it('resets the page window when the search query changes', async () => {
        state.summaries = Array.from({ length: 200 }, (_, index) =>
            summary(`h${index}`, `photo-${index}.png`)
        );
        state.pages.set('start', {
            items: [image('h0')],
            hasMore: true,
            nextCursor: { state: 'active', sort: 'newest', last: [1, 'h0'] },
            missing: 0,
        });
        state.pages.set('h0', {
            items: [image('h1')],
            hasMore: true,
            nextCursor: { state: 'active', sort: 'newest', last: [2, 'h1'] },
            missing: 0,
        });
        state.pages.set('h1', {
            items: [image('h2')],
            hasMore: false,
            nextCursor: null,
            missing: 0,
        });
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        await waitFor(() => gallery.items.value.length === 1, 'page one');
        gallery.loadMore();
        await waitFor(() => gallery.items.value.length === 2, 'page two');
        gallery.loadMore();
        await waitFor(() => gallery.items.value.length === 3, 'page three');

        const callsBefore = state.pageCalls.length;
        gallery.searchQuery.value = 'photo';
        await waitFor(
            () => gallery.matchingTotal.value === 200 && !gallery.loading.value,
            'search results'
        );
        await flush();
        expect(state.pageCalls.length - callsBefore).toBe(1);
        expect(gallery.items.value).toHaveLength(1);
    });
});
