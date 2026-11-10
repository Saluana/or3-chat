import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { makeMeta } from './test-utils';
import type { FileMeta } from '~/db/schema';
import { resetSharedPreviewCache } from '~/composables/core/usePreviewCache';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';

const { getMocks } = vi.hoisted(() => {
    const toastAdd = vi.fn();
    const getFileBlob = vi.fn();
    const reportError = vi.fn();
    return {
        getMocks: () => ({ toastAdd, getFileBlob, reportError }),
    };
});

function createFilesMock() {
    const mocks = getMocks();
    return { getFileBlob: mocks.getFileBlob };
}

function createErrorsMock() {
    const mocks = getMocks();
    return { reportError: mocks.reportError };
}

vi.mock('#imports', () => ({
    useToast: () => ({ add: getMocks().toastAdd }),
    useIcon: (token: string) => ({ value: token }),
}));

vi.mock('../../db/files', createFilesMock);
vi.mock('~/db/files', createFilesMock);
vi.mock(
    new URL('../../../db/files.ts', import.meta.url).pathname,
    createFilesMock
);

vi.mock('../../utils/errors', createErrorsMock);
vi.mock('~/utils/errors', createErrorsMock);
vi.mock(
    new URL('../../../utils/errors.ts', import.meta.url).pathname,
    createErrorsMock
);


const mocks = getMocks();
const wrappers: VueWrapper[] = [];

function stubObjectUrl(
    createObjectURL: ReturnType<typeof vi.fn>,
    revokeObjectURL: ReturnType<typeof vi.fn>
) {
    const NativeURL = globalThis.URL;
    class URLMock extends NativeURL {}
    Object.assign(URLMock, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', URLMock);
}

async function mountGrid(items: FileMeta[]) {
    const GalleryGrid = (await import('../GalleryGrid.vue')).default;
    const wrapper = mount(GalleryGrid, {
        props: {
            items,
            selectionMode: false,
            selectedHashes: new Set<string>(),
            trashMode: false,
            isDeleting: false,
        },
        global: {
            stubs: {
                UButton: true,
                UIcon: true,
                UFieldGroup: true,
            },
        },
    });
    wrappers.push(wrapper);
    return wrapper;
}

describe('GalleryGrid lifecycle management', () => {
    beforeEach(() => {
        setActiveWorkspaceDb('grid-isolation-a');
        mocks.toastAdd.mockReset();
        mocks.getFileBlob.mockReset();
        mocks.reportError.mockReset();
        resetSharedPreviewCache();
    });

    afterEach(() => {
        for (const wrapper of wrappers.splice(0)) wrapper.unmount();
        resetSharedPreviewCache();
        setActiveWorkspaceDb(null);
        evictWorkspaceDb('grid-isolation-a');
        evictWorkspaceDb('grid-isolation-b');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps a shared pending tile alive until its last gallery leaves, including rapid reentry', async () => {
        let sequence = 0;
        const revoke = vi.fn();
        stubObjectUrl(vi.fn(() => `blob:shared-${++sequence}`), revoke);
        const callbacks: IntersectionObserverCallback[] = [];
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callbacks.push(cb); return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        Object.assign(window, { requestIdleCallback: (cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 5 }); return 1; }, cancelIdleCallback: vi.fn() });
        const finish: Array<(blob: Blob) => void> = [];
        mocks.getFileBlob.mockImplementation(() => new Promise<Blob>(resolve => finish.push(resolve)));
        const a = await mountGrid([makeMeta('shared')]);
        const b = await mountGrid([makeMeta('shared')]);
        const send = (index: number, wrapper: VueWrapper, visible: boolean) => callbacks[index]!([{ target: wrapper.get('[data-hash]').element, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
        send(0, a, true); send(1, b, true);
        expect(finish).toHaveLength(1);
        send(1, b, false);
        finish[0]!(new Blob(['first']));
        await flushPromises();
        expect(a.get('img').attributes('src')).toBe('blob:shared-1');
        send(0, a, false);
        await a.setProps({ items: [] });
        await b.setProps({ items: [] });
        await a.setProps({ items: [makeMeta('again')] });
        await b.setProps({ items: [makeMeta('again')] });
        send(0, a, true); send(1, b, true);
        expect(finish).toHaveLength(2);
        send(0, a, false); send(1, b, false);
        send(0, a, true);
        expect(finish).toHaveLength(3);
        finish[1]!(new Blob(['obsolete']));
        await flushPromises();
        expect(a.find('img').exists()).toBe(false);
        finish[2]!(new Blob(['replacement']));
        await flushPromises();
        expect(a.get('img').attributes('src')).toBe('blob:shared-3');
        expect(revoke).toHaveBeenCalledWith('blob:shared-2');
    });

    it.each(['offscreen', 'items', 'unmount'])('keeps a joined gallery loading when the initiating gallery leaves by %s', async (exit) => {
        stubObjectUrl(vi.fn(() => 'blob:survivor'), vi.fn());
        const callbacks: IntersectionObserverCallback[] = [];
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callbacks.push(cb); return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        Object.assign(window, { requestIdleCallback: (cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 5 }); return 1; }, cancelIdleCallback: vi.fn() });
        let finish!: (blob: Blob) => void;
        mocks.getFileBlob.mockImplementation(() => new Promise<Blob>(resolve => { finish = resolve; }));
        const a = await mountGrid([makeMeta('survivor')]);
        const b = await mountGrid([makeMeta('survivor')]);
        const send = (index: number, wrapper: VueWrapper, visible: boolean) => callbacks[index]!([{ target: wrapper.get('[data-hash]').element, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
        send(0, a, true); send(1, b, true);
        if (exit === 'offscreen') send(0, a, false);
        if (exit === 'items') await a.setProps({ items: [] });
        if (exit === 'unmount') a.unmount();
        finish(new Blob(['survivor']));
        await flushPromises();
        expect(b.get('img').attributes('src')).toBe('blob:survivor');
        expect(mocks.getFileBlob).toHaveBeenCalledTimes(1);
    });

    it('loads a local tile while visible remote blobs are stalled and discards stale completions', async () => {
        const create = vi.fn(() => `blob:${Math.random()}`);
        const revoke = vi.fn();
        stubObjectUrl(create, revoke);
        let callback!: IntersectionObserverCallback;
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callback = cb; return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        Object.assign(window, { requestIdleCallback: (cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 5 }); return 1; }, cancelIdleCallback: vi.fn() });
        const finish: Array<(blob: Blob) => void> = [];
        mocks.getFileBlob.mockImplementation((hash: string) => hash.startsWith('remote')
            ? new Promise<Blob>(resolve => finish.push(resolve)) : Promise.resolve(new Blob(['local'])));
        const wrapper = await mountGrid(['remote-0', 'remote-1', 'remote-2', 'local'].map(makeMeta));
        await nextTick();
        const tiles = wrapper.findAll('[data-hash]').map(w => w.element);
        const send = (elements: Element[], isIntersecting: boolean) => callback(elements.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry), {} as IntersectionObserver);
        send(tiles, true);
        await flushPromises();
        expect(finish).toHaveLength(3);
        expect(wrapper.find('[data-hash="local"] img').exists()).toBe(true);
        send([tiles[0]!], false);
        setActiveWorkspaceDb('grid-isolation-b');
        finish.forEach(resolve => resolve(new Blob(['remote'])));
        await flushPromises();
        expect(wrapper.findAll('img')).toHaveLength(0);
        wrapper.unmount();
        expect(revoke).toHaveBeenCalledTimes(create.mock.calls.length);
    });

    it('loads newly visible tiles while obsolete downloads are stalled', async () => {
        stubObjectUrl(vi.fn(() => `blob:${Math.random()}`), vi.fn());
        let callback!: IntersectionObserverCallback;
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callback = cb; return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        Object.assign(window, { requestIdleCallback: (cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 5 }); return 1; }, cancelIdleCallback: vi.fn() });
        const finish: Array<(blob: Blob) => void> = [];
        mocks.getFileBlob.mockImplementation((hash: string) => hash.startsWith('remote')
            ? new Promise<Blob>(resolve => finish.push(resolve)) : Promise.resolve(new Blob(['local'])));
        const items = ['remote-0', 'remote-1', 'remote-2', 'local'].map(makeMeta);
        const wrapper = await mountGrid(items);
        const tiles = wrapper.findAll('[data-hash]').map(w => w.element);
        const send = (elements: Element[], isIntersecting: boolean) => callback(elements.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry), {} as IntersectionObserver);
        send(tiles.slice(0, 3), true);
        await flushPromises();
        expect(finish).toHaveLength(3);
        send(tiles.slice(0, 3), false);
        send([tiles[3]!], true);
        await flushPromises();
        expect(wrapper.findAll('img')).toHaveLength(1);
        mocks.getFileBlob.mockResolvedValue(new Blob(['reentered']));
        send([tiles[0]!], true);
        await flushPromises();
        expect(wrapper.findAll('img')).toHaveLength(2);
        const reentered = wrapper.get('[data-hash="remote-0"] img').attributes('src');
        finish.forEach(resolve => resolve(new Blob(['remote'])));
        await flushPromises();
        expect(wrapper.findAll('img')).toHaveLength(2);
        expect(wrapper.get('[data-hash="remote-0"] img').attributes('src')).toBe(reentered);
    });

    it('keeps obsolete resizes within the concurrency limit', async () => {
        stubObjectUrl(vi.fn(() => `blob:${Math.random()}`), vi.fn());
        let callback!: IntersectionObserverCallback;
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callback = cb; return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        mocks.getFileBlob.mockResolvedValue(new Blob([new Uint8Array([255, 216, 255]), 'image'], { type: 'image/jpeg' }));
        const pending: Array<() => void> = [];
        let active = 0, max = 0;
        vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => {
            active++; max = Math.max(max, active);
            pending.push(() => { active--; resolve({ width: 100, height: 100, close() {} }); });
        })));
        const wrapper = await mountGrid(Array.from({ length: 4 }, (_, i) => makeMeta(`resize-${i}`)));
        await nextTick();
        const tiles = wrapper.findAll('[data-hash]').map(w => w.element);
        const send = (elements: Element[], isIntersecting: boolean) => callback(elements.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry), {} as IntersectionObserver);
        send(tiles.slice(0, 3), true);
        await flushPromises();
        await vi.waitFor(() => expect(active).toBe(3));
        send(tiles.slice(0, 3), false);
        send([tiles[3]!], true);
        await flushPromises();
        expect(active).toBe(3);
        pending.shift()!();
        await vi.waitFor(() => expect(active).toBe(3));
        expect(max).toBe(3);
        pending.splice(0).forEach(finish => finish());
        await flushPromises();
        expect(wrapper.findAll('img')).toHaveLength(1);
    });

    it('bounds visible resize work and drops queued tiles that leave view', async () => {
        stubObjectUrl(vi.fn(() => `blob:${Math.random()}`), vi.fn());
        let callback!: IntersectionObserverCallback;
        let options: IntersectionObserverInit | undefined;
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback, opts: IntersectionObserverInit) {
            callback = cb; options = opts;
            return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        Object.assign(window, { requestIdleCallback: (cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 5 }); return 1; }, cancelIdleCallback: vi.fn() });
        mocks.getFileBlob.mockResolvedValue(new Blob([new Uint8Array([255, 216, 255]), 'image'], { type: 'image/jpeg' }));
        const pending: Array<() => void> = [];
        let active = 0, max = 0;
        vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => {
            active++; max = Math.max(max, active);
            pending.push(() => { active--; resolve({ width: 100, height: 100, close() {} }); });
        })));
        const items = Array.from({ length: 12 }, (_, i) => makeMeta(`queue-${i}`));
        const wrapper = await mountGrid(items);
        await nextTick();
        const tiles = wrapper.findAll('[data-hash]').map(w => w.element);
        const send = (elements: Element[], isIntersecting: boolean) => callback(elements.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry), {} as IntersectionObserver);
        send(tiles, true);
        await flushPromises();
        await vi.waitFor(() => expect(pending).toHaveLength(3));
        expect(max).toBeLessThanOrEqual(3);
        expect(options?.root ?? null).toBeNull();
        send([tiles[11]!], false);
        for (let i = 0; i < 11; i++) {
            await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
            pending.shift()!();
            await flushPromises();
        }
        expect(mocks.getFileBlob).toHaveBeenCalledTimes(12);
        expect(wrapper.findAll('img')).toHaveLength(11);
        send([tiles[11]!], true);
        await flushPromises();
        await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
        pending.shift()!();
        await vi.waitFor(() => expect(wrapper.findAll('img')).toHaveLength(12));
    });

    it.each(['workspace', 'items', 'unmount'])('does not resize queued work after %s changes', async (change) => {
        const revoke = vi.fn();
        stubObjectUrl(vi.fn(() => 'blob:held'), revoke);
        let callback!: IntersectionObserverCallback;
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callback = cb; return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
        Object.assign(window, { requestIdleCallback: (cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 5 }); return 1; }, cancelIdleCallback: vi.fn() });
        mocks.getFileBlob.mockResolvedValue(new Blob([new Uint8Array([255, 216, 255]), 'image'], { type: 'image/jpeg' }));
        const pending: Array<() => void> = [];
        const decode = vi.fn(() => new Promise(resolve => pending.push(() => resolve({ width: 100, height: 100, close() {} }))));
        vi.stubGlobal('createImageBitmap', decode);
        const wrapper = await mountGrid(Array.from({ length: 8 }, (_, i) => makeMeta(`stale-${i}`)));
        const tiles = wrapper.findAll('[data-hash]');
        callback(tiles.map(w => ({ target: w.element, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver);
        await flushPromises();
        await vi.waitFor(() => expect(pending).toHaveLength(3));
        if (change === 'workspace') setActiveWorkspaceDb('grid-isolation-b');
        if (change === 'items') await wrapper.setProps({ items: [] });
        if (change === 'unmount') wrapper.unmount();
        pending.splice(0).forEach(finish => finish());
        await flushPromises();
        expect(mocks.getFileBlob).toHaveBeenCalledTimes(8);
        expect(decode).toHaveBeenCalledTimes(3);
        expect(wrapper.findAll('img')).toHaveLength(0);
        expect(revoke).toHaveBeenCalledTimes(8);
    });

    it('shares decode admission with message thumbnail prefetch', async () => {
        stubObjectUrl(vi.fn(() => `blob:${Math.random()}`), vi.fn());
        let callback!: IntersectionObserverCallback;
        vi.stubGlobal('IntersectionObserver', vi.fn(function (cb: IntersectionObserverCallback) {
            callback = cb; return { observe: vi.fn(), disconnect: vi.fn() };
        }));
        const blob = new Blob([new Uint8Array([255, 216, 255]), 'image'], { type: 'image/jpeg' });
        mocks.getFileBlob.mockResolvedValue(blob);
        const pending: Array<() => void> = [];
        let active = 0, max = 0;
        const decode = vi.fn(() => new Promise(resolve => {
            active++; max = Math.max(max, active);
            pending.push(() => { active--; resolve({ width: 100, height: 100, close() {} }); });
        }));
        vi.stubGlobal('createImageBitmap', decode);
        const wrapper = await mountGrid([makeMeta('tile-a'), makeMeta('tile-b')]);
        callback(wrapper.findAll('[data-hash]').map(w => ({ target: w.element, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver);
        const { createMessageMediaPrefetchController } = await import('~/composables/chat/useMessageMediaPrefetch');
        const controller = createMessageMediaPrefetchController({
            loadMeta: async () => ({ kind: 'image', mime_type: 'image/jpeg' }),
            loadBlob: async () => blob,
        });
        try {
            controller.updateRange([{ role: 'user', file_hashes: ['thumb-a', 'thumb-b', 'thumb-c'] }], { startIndex: 0, endIndex: 0 });
            await vi.waitFor(() => expect(pending).toHaveLength(3));
            for (let i = 0; i < 5; i++) {
                await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
                pending.shift()!();
            }
            await controller.whenIdle();
            await vi.waitFor(() => expect(wrapper.findAll('img')).toHaveLength(2));
            expect(decode).toHaveBeenCalledTimes(5);
            expect(max).toBe(3);
        } finally {
            controller.dispose();
            pending.splice(0).forEach(finish => finish());
        }
    });

    it('keeps the gallery tile separate from the full-size cache entry', async () => {
        const create = vi.fn().mockReturnValueOnce('blob:original').mockReturnValueOnce('blob:tile');
        stubObjectUrl(create, vi.fn());
        const blob = new Blob(['original'], { type: 'image/jpeg' });
        mocks.getFileBlob.mockResolvedValue(blob);
        const cache = (await import('~/composables/core/usePreviewCache')).useSharedPreviewCache()!;
        await cache.ensure('variant', async () => ({ url: URL.createObjectURL(blob), bytes: blob.size }), 1);
        const meta = makeMeta('variant');
        const wrapper = await mountGrid([meta]);
        await (wrapper.vm as unknown as { ensureUrl(meta: FileMeta): Promise<void> }).ensureUrl(meta);
        await nextTick();
        expect(wrapper.get('img').attributes('src')).toBe('blob:tile');
        expect(cache.peek('variant')).toBe('blob:original');
    });

    it('reserves the same dimensions before and after a preview loads', async () => {
        stubObjectUrl(vi.fn(() => 'blob:dimensions'), vi.fn());
        mocks.getFileBlob.mockResolvedValue(new Blob(['image']));
        const meta = { ...makeMeta('dimensions'), width: 800, height: 400 };
        const wrapper = await mountGrid([meta]);
        const placeholder = wrapper.get('button[aria-label="View Image dimensions"]');
        expect((placeholder.element as HTMLElement).style.aspectRatio).toBe('800 / 400');
        expect(placeholder.classes()).toContain('min-h-40');
        expect(placeholder.element.parentElement?.classList.contains('min-h-40')).toBe(true);

        await (wrapper.vm as unknown as { ensureUrl(meta: FileMeta): Promise<void> }).ensureUrl(meta);
        await nextTick();
        const image = wrapper.get('img');
        expect(image.attributes('width')).toBe('800');
        expect(image.attributes('height')).toBe('400');
        expect((image.element as HTMLElement).style.aspectRatio).toBe('auto 800 / 400');
        expect(image.element.parentElement?.parentElement?.classList.contains('min-h-40')).toBe(true);
        expect(image.attributes('decoding')).toBe('async');
    });

    it.each([
        [undefined, undefined], [0, 10], [10, 0], [-1, 10], [NaN, 10], [Infinity, 10],
    ])('keeps the fallback for invalid dimensions %s by %s', async (width, height) => {
        const wrapper = await mountGrid([{ ...makeMeta('fallback'), width, height }]);
        const placeholder = wrapper.get('button[aria-label="View Image fallback"]');
        expect(placeholder.classes()).toContain('min-h-40');
        expect((placeholder.element as HTMLElement).style.aspectRatio).toBe('');
    });

    it('discards a held preview and clears displayed URLs when switching workspaces', async () => {
        const createObjectURL = vi.fn(() => 'blob:old-grid');
        stubObjectUrl(createObjectURL, vi.fn());
        let finish!: (blob: Blob) => void;
        mocks.getFileBlob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const meta = makeMeta('held-grid');
        const wrapper = await mountGrid([meta]);
        const vm = wrapper.vm as unknown as { ensureUrl(meta: FileMeta): Promise<void> };
        const reading = vm.ensureUrl(meta);
        setActiveWorkspaceDb('grid-isolation-b');
        await wrapper.setProps({ items: [] });
        finish(new Blob(['workspace-a-only'], { type: 'image/png' }));
        await reading;
        expect(wrapper.find('img').exists()).toBe(false);
        expect(mocks.reportError).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('does not let an old workspace load failure poison the next preview with the same hash', async () => {
        stubObjectUrl(vi.fn(() => 'blob:next-grid'), vi.fn());
        let fail!: (error: Error) => void;
        mocks.getFileBlob.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        const meta = makeMeta('reused-grid-hash');
        const wrapper = await mountGrid([meta]);
        const vm = wrapper.vm as unknown as { ensureUrl(meta: FileMeta): Promise<void> };
        const oldRead = vm.ensureUrl(meta);
        setActiveWorkspaceDb('grid-isolation-b');
        mocks.getFileBlob.mockResolvedValue(new Blob(['next-workspace'], { type: 'image/png' }));
        await wrapper.setProps({ items: [{ ...meta, name: 'Workspace B preview' }] });
        await vm.ensureUrl({ ...meta, name: 'Workspace B preview' });
        fail(new Error('old-workspace-read-failed'));
        await oldRead;
        await nextTick();
        expect(wrapper.get('img').attributes('src')).toBe('blob:next-grid');
        expect(mocks.reportError).not.toHaveBeenCalled();
        await vm.ensureUrl(meta);
        expect(mocks.getFileBlob).toHaveBeenCalledTimes(2);
    });

    it('revokes object URLs when items are removed', async () => {
        const createObjectURL = vi.fn(() => 'blob://meta-a');
        const revokeObjectURL = vi.fn();
        stubObjectUrl(createObjectURL, revokeObjectURL);

        const idleCallbacks = new Map<number, any>();
        let idleHandle = 1;
        const requestIdleCallback = vi.fn((cb: any) => {
            const id = idleHandle++;
            idleCallbacks.set(id, cb);
            return id;
        });
        const cancelIdleCallback = vi.fn((id: number) => {
            idleCallbacks.delete(id);
        });
        const originalRequestIdle = window.requestIdleCallback;
        const originalCancelIdle = window.cancelIdleCallback;
        Object.assign(window as any, {
            requestIdleCallback,
            cancelIdleCallback,
        });

        vi.stubGlobal('requestAnimationFrame', (cb: any) => {
            cb(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const observe = vi.fn();
        const disconnect = vi.fn();
        vi.stubGlobal(
            'IntersectionObserver',
            vi.fn(function () {
                return { observe, disconnect };
            })
        );

        mocks.getFileBlob.mockResolvedValue(
            new Blob(['ok'], { type: 'image/png' })
        );

        const meta = makeMeta('meta-a');
        const wrapper = await mountGrid([meta]);

        for (const cb of idleCallbacks.values()) {
            cb({ didTimeout: false, timeRemaining: () => 5 } as any);
        }
        idleCallbacks.clear();
        await nextTick();

        await (
            wrapper.vm as unknown as {
                ensureUrl(meta: FileMeta): Promise<void>;
            }
        ).ensureUrl(meta);

        expect(createObjectURL).toHaveBeenCalledTimes(1);

        await wrapper.setProps({
            items: [],
            selectedHashes: new Set<string>(),
        });
        await nextTick();

        expect(revokeObjectURL).toHaveBeenCalledWith('blob://meta-a');

        window.requestIdleCallback = originalRequestIdle;
        window.cancelIdleCallback = originalCancelIdle;
    });

    it('coalesces observer binding across rapid prop updates', async () => {
        const idleCallbacks = new Map<number, any>();
        let idleHandle = 1;
        const requestIdleCallback = vi.fn((cb: any) => {
            const id = idleHandle++;
            idleCallbacks.set(id, cb);
            return id;
        });
        const cancelIdleCallback = vi.fn((id: number) => {
            idleCallbacks.delete(id);
        });
        const originalRequestIdle = window.requestIdleCallback;
        const originalCancelIdle = window.cancelIdleCallback;
        Object.assign(window as any, {
            requestIdleCallback,
            cancelIdleCallback,
        });

        vi.stubGlobal('requestAnimationFrame', (cb: any) => {
            cb(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const observe = vi.fn();
        const disconnect = vi.fn();
        const IntersectionObserverMock = vi.fn(function () {
            return { observe, disconnect };
        });
        vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

        mocks.getFileBlob.mockResolvedValue(
            new Blob(['ok'], { type: 'image/png' })
        );

        const metaA = makeMeta('meta-a');
        const metaB = makeMeta('meta-b');
        const wrapper = await mountGrid([metaA]);

        for (const cb of idleCallbacks.values()) {
            cb({ didTimeout: false, timeRemaining: () => 5 } as any);
        }
        idleCallbacks.clear();
        await nextTick();

        observe.mockClear();
        disconnect.mockClear();
        requestIdleCallback.mockClear();
        cancelIdleCallback.mockClear();

        await wrapper.setProps({
            items: [metaA, metaB],
            selectedHashes: new Set<string>(),
        });
        await wrapper.setProps({
            items: [metaA],
            selectedHashes: new Set<string>(),
        });

        expect(requestIdleCallback).toHaveBeenCalledTimes(2);
        expect(cancelIdleCallback).toHaveBeenCalledTimes(1);
        expect(idleCallbacks.size).toBe(1);

        for (const cb of idleCallbacks.values()) {
            cb({ didTimeout: false, timeRemaining: () => 5 } as any);
        }
        idleCallbacks.clear();
        await nextTick();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(observe).toHaveBeenCalledTimes(1);
        expect((observe.mock.calls[0]?.[0] as HTMLElement)?.dataset?.hash).toBe(
            'meta-a'
        );

        window.requestIdleCallback = originalRequestIdle;
        window.cancelIdleCallback = originalCancelIdle;
    });

    it('reloads visible previews after the tab is hidden then shown', async () => {
        let urlSeq = 0;
        const createObjectURL = vi.fn(() => `blob://preview-${++urlSeq}`);
        const revokeObjectURL = vi.fn();
        stubObjectUrl(createObjectURL, revokeObjectURL);

        const idleCallbacks = new Map<number, IdleRequestCallback>();
        let idleHandle = 1;
        Object.assign(window as Window & {
            requestIdleCallback: typeof window.requestIdleCallback;
            cancelIdleCallback: typeof window.cancelIdleCallback;
        }, {
            requestIdleCallback: vi.fn((cb: IdleRequestCallback) => {
                const id = idleHandle++;
                idleCallbacks.set(id, cb);
                return id;
            }),
            cancelIdleCallback: vi.fn((id: number) => {
                idleCallbacks.delete(id);
            }),
        });

        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });

        type IoCallback = IntersectionObserverCallback;
        let ioCallback: IoCallback | null = null;
        const observe = vi.fn((el: Element) => {
            if (!ioCallback) return;
            ioCallback(
                [
                    {
                        isIntersecting: true,
                        target: el,
                    } as IntersectionObserverEntry,
                ],
                {} as IntersectionObserver
            );
        });
        const disconnect = vi.fn();
        vi.stubGlobal(
            'IntersectionObserver',
            vi.fn(function (this: unknown, cb: IoCallback) {
                ioCallback = cb;
                return { observe, disconnect };
            })
        );

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState,
        });
        let visibilityState: DocumentVisibilityState = 'visible';

        mocks.getFileBlob.mockResolvedValue(
            new Blob(['ok'], { type: 'image/png' })
        );

        const meta = makeMeta('meta-visible');
        const wrapper = await mountGrid([meta]);

        for (const cb of idleCallbacks.values()) {
            cb({ didTimeout: false, timeRemaining: () => 5 });
        }
        idleCallbacks.clear();
        await flushPromises();
        await nextTick();

        expect(wrapper.get('img').attributes('src')).toBe('blob://preview-1');
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(mocks.getFileBlob).toHaveBeenCalledTimes(1);

        visibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        await flushPromises();
        await nextTick();

        expect(revokeObjectURL).toHaveBeenCalledWith('blob://preview-1');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toContain('Loading preview');

        visibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        await flushPromises();
        await nextTick();

        for (const cb of idleCallbacks.values()) {
            cb({ didTimeout: false, timeRemaining: () => 5 });
        }
        idleCallbacks.clear();
        await flushPromises();
        await nextTick();

        expect(mocks.getFileBlob).toHaveBeenCalledTimes(2);
        expect(createObjectURL).toHaveBeenCalledTimes(2);
        expect(wrapper.get('img').attributes('src')).toBe('blob://preview-2');

        wrapper.unmount();
    });

    it('falls back to setTimeout scheduling when requestIdleCallback is missing', async () => {
        vi.useFakeTimers();

        const originalRequestIdle = window.requestIdleCallback;
        const originalCancelIdle = window.cancelIdleCallback;
        Object.assign(window as any, {
            requestIdleCallback: undefined,
            cancelIdleCallback: undefined,
        });

        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        vi.stubGlobal('requestAnimationFrame', (cb: any) => {
            cb(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const observe = vi.fn();
        const disconnect = vi.fn();
        vi.stubGlobal(
            'IntersectionObserver',
            vi.fn(function () {
                return { observe, disconnect };
            })
        );

        mocks.getFileBlob.mockResolvedValue(
            new Blob(['ok'], { type: 'image/png' })
        );

        const meta = makeMeta('meta-a');
        await mountGrid([meta]);

        await vi.runAllTimersAsync();
        await nextTick();

        expect(setTimeoutSpy).toHaveBeenCalled();
        expect(observe).toHaveBeenCalled();

        setTimeoutSpy.mockRestore();
        window.requestIdleCallback = originalRequestIdle;
        window.cancelIdleCallback = originalCancelIdle;
    });
});
