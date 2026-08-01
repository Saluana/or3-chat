import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { makeMeta } from './test-utils';
import type { FileMeta } from '~/db/schema';
import { resetSharedPreviewCache } from '~/composables/core/usePreviewCache';

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
                UFieldGroup: true,
            },
        },
    });
}

describe('GalleryGrid lifecycle management', () => {
    beforeEach(() => {
        mocks.toastAdd.mockReset();
        mocks.getFileBlob.mockReset();
        mocks.reportError.mockReset();
        resetSharedPreviewCache();
    });

    afterEach(() => {
        resetSharedPreviewCache();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
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
