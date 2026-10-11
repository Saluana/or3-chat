import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Blob as NativeBlob } from 'node:buffer';
import { mount, flushPromises } from '@vue/test-utils';
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
import * as fileOperations from '~/db/files';
import * as clipboardOperations from '../copy-image-to-clipboard';

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

    it.each(['changed', 'returned', 'unchanged'] as const)('fences delayed palette image selection when the workspace is %s during metadata lookup', async (change) => {
        const nextWorkspace = `gallery-palette-next-${crypto.randomUUID()}`;
        const Page = (await import('../index.vue')).default;
        const wrapper = mount(Page, { global: { stubs: { GalleryGrid: true, ImageViewer: true, USelect: true } } });
        const vm = wrapper.vm as unknown as { stopGallery(): void; openPaletteSelection(hash: string): Promise<void>; showViewer: boolean };
        vm.stopGallery();
        await flushPromises();
        const row = meta(`sha256:${'a'.repeat(64)}`);
        await db.file_meta.put(row);
        const originalRead = fileOperations.getFileMeta;
        const read = vi.spyOn(fileOperations, 'getFileMeta').mockImplementation(async (...args) => {
            const result = await originalRead(...args);
            queueMicrotask(() => {
                if (change === 'unchanged') return;
                setActiveWorkspaceDb(nextWorkspace);
                if (change === 'returned') setActiveWorkspaceDb(workspaceId);
            });
            return result;
        });
        try {
            await vm.openPaletteSelection(row.hash);
            expect(vm.showViewer).toBe(change === 'unchanged');
        } finally {
            read.mockRestore();
            wrapper.unmount();
            setActiveWorkspaceDb(nextWorkspace).close();
            setActiveWorkspaceDb(workspaceId);
            evictWorkspaceDb(nextWorkspace);
            await Dexie.delete(`or3-db-${nextWorkspace}`);
        }
    });

    it.each(['download', 'copy'] as const)('fences gallery %s delivery after a workspace change during its blob read', async (action) => {
        const nextWorkspace = `gallery-delivery-next-${crypto.randomUUID()}`;
        const Page = (await import('../index.vue')).default;
        const wrapper = mount(Page, { global: { stubs: { GalleryGrid: true, ImageViewer: true, USelect: true } } });
        const vm = wrapper.vm as unknown as { handleDownload(meta: FileMeta): Promise<void>; handleCopy(meta: FileMeta): Promise<void>; stopGallery(): void };
        vm.stopGallery();
        await flushPromises();
        class ObjectUrl extends URL {}
        Object.assign(ObjectUrl, { createObjectURL: vi.fn(() => 'blob:synthetic-gallery-delivery'), revokeObjectURL: vi.fn() });
        vi.stubGlobal('URL', ObjectUrl);
        const row = meta('delivery-origin');
        await db.file_blobs.put({ hash: row.hash, blob: new NativeBlob(['origin-only'], { type: 'image/png' }) as unknown as Blob });
        const originalRead = fileOperations.getFileBlob;
        let change: 'changed' | 'returned' | 'unchanged' = 'changed';
        const read = vi.spyOn(fileOperations, 'getFileBlob').mockImplementation(async (...args) => {
            const result = await originalRead(...args);
            queueMicrotask(() => {
                if (change === 'unchanged') return;
                setActiveWorkspaceDb(nextWorkspace);
                if (change === 'returned') setActiveWorkspaceDb(workspaceId);
            });
            return result;
        });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const copy = vi.spyOn(clipboardOperations, 'copyImageBlobToClipboard').mockResolvedValue(undefined);
        try {
            for (const scenario of ['changed', 'returned', 'unchanged'] as const) {
                change = scenario;
                setActiveWorkspaceDb(workspaceId);
                click.mockClear();
                copy.mockClear();
                await (action === 'download' ? vm.handleDownload(row) : vm.handleCopy(row));
                expect(action === 'download' ? click : copy).toHaveBeenCalledTimes(scenario === 'unchanged' ? 1 : 0);
            }
        } finally {
            vi.unstubAllGlobals();
            read.mockRestore();
            click.mockRestore();
            copy.mockRestore();
            wrapper.unmount();
            setActiveWorkspaceDb(nextWorkspace).close();
            setActiveWorkspaceDb(workspaceId);
            evictWorkspaceDb(nextWorkspace);
            await Dexie.delete(`or3-db-${nextWorkspace}`);
        }
    });

    it.each(['changed', 'returned', 'unchanged'] as const)('keeps gallery upload batch ownership when the workspace is %s between file completions', async (change) => {
        const nextWorkspace = `gallery-upload-next-${crypto.randomUUID()}`;
        const Page = (await import('../index.vue')).default;
        const wrapper = mount(Page, { global: { stubs: { GalleryGrid: true, ImageViewer: true, USelect: true } } });
        const originalCreate = fileOperations.createOrRefFile;
        let first = true;
        const create = vi.spyOn(fileOperations, 'createOrRefFile').mockImplementation(async (...args) => {
            const result = await originalCreate(...args);
            if (first) {
                first = false;
                // A queued workspace event wins between one file's settled
                // creation and the outer batch's asynchronous continuation.
                queueMicrotask(() => {
                    if (change === 'unchanged') return;
                    setActiveWorkspaceDb(nextWorkspace);
                    if (change === 'returned') setActiveWorkspaceDb(workspaceId);
                });
            }
            return result;
        });
        const files = ['origin-one', 'origin-two'].map(name => Object.assign(
            new NativeBlob([name], { type: 'image/png' }), { name: `${name}.png` },
        ));
        try {
            await (wrapper.vm as unknown as { handleUpload(event: Event): Promise<void> }).handleUpload({
                target: { files, value: 'synthetic-selection' },
            } as unknown as Event);
            const nextDb = setActiveWorkspaceDb(nextWorkspace);
            expect(await nextDb.file_meta.count()).toBe(0);
            expect(await db.file_meta.count()).toBe(change === 'unchanged' ? 2 : 1);
        } finally {
            create.mockRestore();
            wrapper.unmount();
            setActiveWorkspaceDb(workspaceId);
            evictWorkspaceDb(nextWorkspace);
            await Dexie.delete(`or3-db-${nextWorkspace}`);
        }
    });

    it.each(['changed', 'returned', 'unchanged'] as const)('keeps gallery picker ownership when the workspace is %s before file selection', async (change) => {
        const nextWorkspace = `gallery-picker-next-${crypto.randomUUID()}`;
        const Page = (await import('../index.vue')).default;
        const wrapper = mount(Page, { global: { stubs: { GalleryGrid: true, ImageViewer: true, USelect: true } } });
        const vm = wrapper.vm as unknown as { openUploadPicker(): void; handleUpload(event: Event): Promise<void> };
        const input = wrapper.get('input[type="file"]').element as HTMLInputElement;
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});
        vm.openUploadPicker();
        if (change !== 'unchanged') {
            setActiveWorkspaceDb(nextWorkspace);
            if (change === 'returned') setActiveWorkspaceDb(workspaceId);
        }
        try {
            const file = Object.assign(new NativeBlob(['picker-origin'], { type: 'image/png' }), { name: 'picker-origin.png' });
            await vm.handleUpload({ target: { files: [file], value: 'synthetic-selection' } } as unknown as Event);
            const nextDb = setActiveWorkspaceDb(nextWorkspace);
            expect(await nextDb.file_meta.count()).toBe(0);
            expect(await db.file_meta.count()).toBe(change === 'unchanged' ? 1 : 0);
        } finally {
            click.mockRestore();
            wrapper.unmount();
            setActiveWorkspaceDb(workspaceId);
            evictWorkspaceDb(nextWorkspace);
            await Dexie.delete(`or3-db-${nextWorkspace}`);
        }
    });

    it.each(['cancel', 'empty selection'] as const)('clears the old picker owner after %s so a new direct selection uses the current workspace', async (cancel) => {
        const nextWorkspace = `gallery-picker-cancel-${crypto.randomUUID()}`;
        const Page = (await import('../index.vue')).default;
        const wrapper = mount(Page, { global: { stubs: { GalleryGrid: true, ImageViewer: true, USelect: true } } });
        const vm = wrapper.vm as unknown as { openUploadPicker(): void; handleUpload(event: Event): Promise<void> };
        const input = wrapper.get('input[type="file"]');
        const click = vi.spyOn(input.element as HTMLInputElement, 'click').mockImplementation(() => {});
        vm.openUploadPicker();
        const nextDb = setActiveWorkspaceDb(nextWorkspace);
        try {
            if (cancel === 'cancel') await input.trigger('cancel');
            else await vm.handleUpload({ target: { files: [], value: '' } } as unknown as Event);
            const file = Object.assign(new NativeBlob(['new-selection'], { type: 'image/png' }), { name: 'new-selection.png' });
            await vm.handleUpload({ target: { files: [file], value: 'synthetic-new-selection' } } as unknown as Event);
            expect(await nextDb.file_meta.count()).toBe(1);
            expect(await db.file_meta.count()).toBe(0);
        } finally {
            click.mockRestore();
            wrapper.unmount();
            setActiveWorkspaceDb(workspaceId);
            evictWorkspaceDb(nextWorkspace);
            await Dexie.delete(`or3-db-${nextWorkspace}`);
        }
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
