import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import {
    evictWorkspaceDb,
    setActiveWorkspaceDb,
    type Or3DB,
} from '~/db/client';
import { softDeleteMany, restoreMany } from '~/db/files';
import { updateFileName } from '~/db/files-select';
import type { FileMeta } from '~/db/schema';
import { useImageGallery } from '../useImageGallery';

const hooksMock = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
    applyFilters: vi.fn(async (_name: string, value: unknown) => value),
    applyFiltersSync: vi.fn((_: string, value: string[]) => value),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hooksMock.doAction,
        applyFilters: hooksMock.applyFilters,
        _engine: {
            applyFiltersSync: hooksMock.applyFiltersSync,
        },
    }),
}));

function meta(hash: string, overrides: Partial<FileMeta> = {}): FileMeta {
    return {
        hash,
        name: `${hash}.png`,
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 100,
        ref_count: 0,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 1,
        ...overrides,
    } as FileMeta;
}

async function waitFor(
    condition: () => boolean,
    message = 'condition',
    timeout = 4000
): Promise<void> {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeout) {
            throw new Error(`Timed out waiting for ${message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('useImageGallery integration', () => {
    let db: Or3DB;
    let workspaceId: string;
    let scope: EffectScope;

    beforeEach(async () => {
        (process as unknown as { client?: boolean }).client = true;
        workspaceId = `gallery-ctl-${crypto.randomUUID()}`;
        db = setActiveWorkspaceDb(workspaceId);
        await db.open();
        scope = effectScope();
    });

    afterEach(async () => {
        scope.stop();
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(workspaceId);
        await Dexie.delete(db.name);
    });

    function startGallery() {
        const gallery = scope.run(() => useImageGallery())!;
        gallery.start();
        return gallery;
    }

    it('renders the first page before aggregates and exposes global counts', async () => {
        await db.file_meta.bulkPut(
            Array.from({ length: 60 }, (_, index) =>
                meta(`h${String(index).padStart(3, '0')}`, {
                    created_at: 1000 + index,
                })
            )
        );
        const gallery = startGallery();
        await waitFor(() => gallery.items.value.length === 50, 'first page');
        expect(gallery.items.value[0]!.hash).toBe('h059');
        expect(gallery.done.value).toBe(false);

        await waitFor(
            () => gallery.counts.value.all === 60,
            'global counts'
        );
        expect(gallery.matchingTotal.value).toBe(60);

        await waitFor(() => !gallery.loading.value, 'idle');
        await gallery.loadMore();
        await waitFor(() => gallery.items.value.length === 60, 'second page');
        expect(gallery.items.value.at(-1)!.hash).toBe('h000');
        expect(gallery.done.value).toBe(true);
    });

    it('searches the whole corpus and keeps matches beyond page one pageable', async () => {
        const rows = [
            ...Array.from({ length: 120 }, (_, index) =>
                meta(`photo-${String(index).padStart(3, '0')}`, {
                    name: `photo-${index}.png`,
                    created_at: 1000 + index,
                })
            ),
            ...Array.from({ length: 30 }, (_, index) =>
                meta(`other-${index}`, {
                    name: `other-${index}.png`,
                    created_at: index,
                })
            ),
        ];
        await db.file_meta.bulkPut(rows);
        const gallery = startGallery();
        await waitFor(() => gallery.items.value.length === 50, 'first page');

        gallery.searchQuery.value = 'photo';
        await waitFor(
            () =>
                gallery.matchingTotal.value === 120 &&
                gallery.items.value.length === 50,
            'global match total and page'
        );
        expect(
            gallery.items.value.every((item) =>
                item.name.startsWith('photo-')
            )
        ).toBe(true);

        await waitFor(() => !gallery.loading.value, 'idle');
        await gallery.loadMore();
        await waitFor(
            () => gallery.items.value.length === 100,
            'second match page'
        );
        expect(
            gallery.items.value.every((item) =>
                item.name.startsWith('photo-')
            )
        ).toBe(true);

        gallery.searchQuery.value = '';
        await waitFor(
            () =>
                gallery.matchingTotal.value === 150 &&
                !gallery.loading.value,
            'cleared search total'
        );
    });

    it('computes global category counts including document references', async () => {
        await db.file_meta.bulkPut([
            meta('upload-1', { name: 'photo.png', created_at: 1 }),
            meta('upload-2', { name: 'sunset.png', created_at: 2 }),
            meta('gen-1', { name: 'gen-image-1.png', created_at: 3 }),
            meta('used-1', { name: 'hero.png', created_at: 4 }),
            meta('trash-1', { name: 'old.png', created_at: 5, deleted: true }),
        ]);
        await db.posts.put({
            id: 'doc-1',
            title: 'Doc',
            content: JSON.stringify({ type: 'doc', content: [] }),
            postType: 'doc',
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 1,
            meta: '',
            file_hashes: JSON.stringify(['used-1']),
        });

        const gallery = startGallery();
        await waitFor(
            () => gallery.counts.value['used-in-docs'] === 1,
            'used-in-docs count'
        );
        expect(gallery.counts.value).toMatchObject({
            all: 4,
            uploads: 3,
            generated: 1,
            'used-in-docs': 1,
            trash: 1,
        });

        gallery.activeView.value = 'used-in-docs';
        await nextTick();
        await waitFor(
            () => gallery.items.value[0]?.hash === 'used-1',
            'used-in-docs page'
        );
        expect(gallery.items.value).toHaveLength(1);
        expect(gallery.matchingTotal.value).toBe(1);

        gallery.activeView.value = 'generated';
        await nextTick();
        await waitFor(
            () => gallery.items.value[0]?.hash === 'gen-1',
            'generated page'
        );
        expect(gallery.items.value).toHaveLength(1);

        gallery.activeView.value = 'trash';
        await nextTick();
        await waitFor(
            () => gallery.items.value[0]?.hash === 'trash-1',
            'trash page'
        );
        expect(gallery.items.value).toHaveLength(1);
    });

    it('invalidates counts and results on same-count renames', async () => {
        await db.file_meta.bulkPut(
            Array.from({ length: 5 }, (_, index) =>
                meta(`photo-${index}`, {
                    name: `photo-${index}.png`,
                    created_at: index,
                })
            )
        );
        const gallery = startGallery();
        gallery.searchQuery.value = 'photo';
        await waitFor(
            () => gallery.matchingTotal.value === 5,
            'initial matches'
        );

        await updateFileName('photo-0', 'renamed.png');
        await waitFor(
            () => gallery.matchingTotal.value === 4,
            'renamed match total'
        );
    });

    it('refreshes pages after destructive actions', async () => {
        await db.file_meta.bulkPut(
            Array.from({ length: 60 }, (_, index) =>
                meta(`h${String(index).padStart(3, '0')}`, {
                    created_at: 1000 + index,
                })
            )
        );
        const gallery = startGallery();
        await waitFor(() => gallery.items.value.length === 50, 'first page');

        await softDeleteMany(['h059', 'h058']);
        await waitFor(
            () => gallery.counts.value.trash === 2,
            'trash count'
        );
        await waitFor(
            () =>
                !gallery.items.value.some((item) => item.hash === 'h059'),
            'page refresh after delete'
        );
        expect(gallery.counts.value.all).toBe(58);

        await restoreMany(['h059']);
        await waitFor(
            () => gallery.counts.value.trash === 1,
            'restored count'
        );
    });

    it('clears pages, selection state, and search on workspace change', async () => {
        await db.file_meta.bulkPut(
            Array.from({ length: 60 }, (_, index) =>
                meta(`h${index}`, { created_at: index })
            )
        );
        const gallery = startGallery();
        await waitFor(() => gallery.items.value.length === 50, 'first page');
        gallery.searchQuery.value = 'h1';
        await waitFor(
            () => gallery.matchingTotal.value !== null,
            'search ready'
        );

        let workspaceChangeCalls = 0;
        const scoped = scope.run(() =>
            useImageGallery({
                onWorkspaceChange: () => {
                    workspaceChangeCalls += 1;
                },
            })
        )!;
        scoped.start();
        await waitFor(() => scoped.items.value.length === 50, 'scoped page');

        const nextWorkspace = `gallery-empty-${crypto.randomUUID()}`;
        const nextDb = setActiveWorkspaceDb(nextWorkspace);
        await nextDb.open();
        try {
            expect(workspaceChangeCalls).toBe(1);
            expect(scoped.items.value).toHaveLength(0);
            expect(scoped.activeView.value).toBe('all');
            await waitFor(
                () => scoped.counts.value.all === 0,
                'empty workspace counts'
            );
            expect(scoped.matchingTotal.value).toBe(0);
        } finally {
            scoped.stop();
            setActiveWorkspaceDb(workspaceId);
            await db.open();
        }
    });

    it('rejects stale view results when the view changes mid-flight', async () => {
        await db.file_meta.bulkPut([
            ...Array.from({ length: 60 }, (_, index) =>
                meta(`active-${index}`, { created_at: 1000 + index })
            ),
            ...Array.from({ length: 5 }, (_, index) =>
                meta(`trash-${index}`, {
                    created_at: index,
                    deleted: true,
                })
            ),
        ]);
        const gallery = startGallery();
        await waitFor(() => gallery.items.value.length === 50, 'first page');

        gallery.activeView.value = 'uploads';
        gallery.activeView.value = 'trash';
        await waitFor(
            () =>
                gallery.items.value.length === 5 &&
                gallery.items.value.every((item) =>
                    item.hash.startsWith('trash-')
                ),
            'trash results'
        );
        expect(gallery.items.value.map((item) => item.hash).sort()).toEqual([
            'trash-0',
            'trash-1',
            'trash-2',
            'trash-3',
            'trash-4',
        ]);
    });

    it('pages locale-aware name orders with no duplicates', async () => {
        await db.file_meta.bulkPut(
            Array.from({ length: 60 }, (_, index) =>
                meta(`h${String(index).padStart(2, '0')}`, {
                    // A/B prefixes force a name order independent of timestamps.
                    name:
                        index % 2 === 0
                            ? `b-${String(index).padStart(2, '0')}.png`
                            : `a-${String(index).padStart(2, '0')}.png`,
                    created_at: 1000 + index,
                })
            )
        );
        const gallery = startGallery();
        gallery.sortMode.value = 'name-asc';
        await waitFor(
            () =>
                gallery.items.value.length === 50 &&
                gallery.items.value[0]?.name === 'a-01.png',
            'name page one'
        );
        expect(gallery.items.value[29]!.name).toBe('a-59.png');
        expect(gallery.items.value[30]!.name).toBe('b-00.png');
        expect(gallery.items.value[49]!.name).toBe('b-38.png');
        expect(gallery.done.value).toBe(false);

        await waitFor(() => !gallery.loading.value, 'idle');
        await gallery.loadMore();
        await waitFor(
            () => gallery.items.value.length === 60,
            'name page two'
        );
        expect(gallery.items.value[59]!.name).toBe('b-58.png');
        expect(new Set(gallery.items.value.map((item) => item.hash)).size).toBe(
            60
        );
        expect(gallery.done.value).toBe(true);
    });
});
