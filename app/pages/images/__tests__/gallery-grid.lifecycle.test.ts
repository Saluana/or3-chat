import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { FileMeta } from '~/db/schema';

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

const makeMeta = (hash: string): FileMeta => ({
    hash,
    name: `Image ${hash}`,
    mime_type: 'image/png',
    kind: 'image',
    size_bytes: 128,
    width: 16,
    height: 16,
    page_count: undefined,
    ref_count: 0,
    created_at: 1,
    updated_at: 2,
    deleted: false,
    clock: 0,
});

async function mountGrid(items: FileMeta[]) {
    const GalleryGrid = (await import('../GalleryGrid.vue')).default;
    return mount(GalleryGrid, {
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
                UButtonGroup: true,
            },
        },
    });
}

describe('GalleryGrid lifecycle management', () => {
    beforeEach(() => {
        mocks.toastAdd.mockReset();
        mocks.getFileBlob.mockReset();
        mocks.reportError.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('revokes object URLs when items are removed', async () => {
        const createObjectURL = vi.fn(() => 'blob://meta-a');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', {
            createObjectURL,
            revokeObjectURL,
        });

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
            vi.fn(() => ({ observe, disconnect }))
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
        const IntersectionObserverMock = vi.fn(() => ({ observe, disconnect }));
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
            vi.fn(() => ({ observe, disconnect }))
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
