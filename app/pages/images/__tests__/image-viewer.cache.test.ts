import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { makeMeta } from './test-utils';
import type { FileMeta } from '~/db/schema';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';

const factory = vi.hoisted(() => {
    const toastAdd = vi.fn();
    const getFileBlob = vi.fn();
    const reportError = vi.fn();
    const onKeyStroke = vi.fn();
    return { toastAdd, getFileBlob, reportError, onKeyStroke };
});

vi.mock('#imports', () => ({
    useToast: () => ({ add: factory.toastAdd }),
    useIcon: (name: string) => name,
}));
vi.mock('~/db/files', () => ({ getFileBlob: factory.getFileBlob }));
vi.mock('~/utils/errors', () => ({ reportError: factory.reportError }));
vi.mock('@vueuse/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@vueuse/core')>()),
    onKeyStroke: factory.onKeyStroke,
}));

function stubObjectUrl(
    createObjectURL: ReturnType<typeof vi.fn>,
    revokeObjectURL: ReturnType<typeof vi.fn>
) {
    const NativeURL = globalThis.URL;
    class URLMock extends NativeURL {}
    Object.assign(URLMock, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', URLMock);
}

describe('ImageViewer preview cache reuse', () => {
    const wrappers: VueWrapper[] = [];
    beforeEach(async () => {
        setActiveWorkspaceDb('viewer-isolation-a');
        factory.toastAdd.mockReset();
        factory.getFileBlob.mockReset();
        factory.reportError.mockReset();
        factory.onKeyStroke.mockReset();

        const mod = await import('~/composables/core/usePreviewCache');
        mod.resetSharedPreviewCache();
        mod.useSharedPreviewCache({
            maxUrls: 1,
            maxBytes: Number.POSITIVE_INFINITY,
        });
    });

    afterEach(async () => {
        for (const wrapper of wrappers.splice(0)) wrapper.unmount();
        (await import('~/composables/core/usePreviewCache')).resetSharedPreviewCache();
        setActiveWorkspaceDb(null);
        evictWorkspaceDb('viewer-isolation-a');
        evictWorkspaceDb('viewer-isolation-b');
        vi.unstubAllGlobals();
    });

    async function mountViewer(meta: FileMeta | null, modelValue = true) {
        const ImageViewer = (await import('../ImageViewer.vue')).default;
        const wrapper = mount(ImageViewer, {
            props: { modelValue, meta },
            global: {
                stubs: {
                    UModal: {
                        name: 'ModalStub',
                        template: '<div><slot /><slot name="content" /></div>',
                    },
                    UButton: true,
                    UFieldGroup: true,
                    UIcon: true,
                    teleport: true,
                },
            },
        });
        wrappers.push(wrapper);
        return wrapper;
    }

    it('reuses cached previews when reopening with the same hash', async () => {
        const createObjectURL = vi.fn(() => 'blob://viewer');
        const revokeObjectURL = vi.fn();
        stubObjectUrl(createObjectURL, revokeObjectURL);

        factory.getFileBlob.mockResolvedValue(
            new Blob(['primary'], { type: 'image/png' })
        );

        const meta = makeMeta('viewer-a');
        const wrapper = await mountViewer(meta, true);

        await flushPromises();
        await flushPromises();

        expect(factory.getFileBlob).toHaveBeenCalledTimes(1);
        expect(createObjectURL).toHaveBeenCalledTimes(1);

        await wrapper.setProps({ modelValue: false, meta: null });
        await flushPromises();

        await wrapper.setProps({ modelValue: true, meta });
        await flushPromises();

        expect(factory.getFileBlob).toHaveBeenCalledTimes(1);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it('does not display a held preview after switching workspaces', async () => {
        stubObjectUrl(vi.fn(() => 'blob:old-workspace'), vi.fn());
        let finish!: (blob: Blob) => void;
        factory.getFileBlob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const wrapper = await mountViewer(makeMeta('held-preview'));
        await flushPromises();
        setActiveWorkspaceDb('viewer-isolation-b');
        finish(new Blob(['workspace-a-private-fixture'], { type: 'image/png' }));
        await flushPromises();
        expect(wrapper.find('img').exists()).toBe(false);
        wrapper.unmount();
    });

    it('clears a displayed preview synchronously when the workspace changes', async () => {
        stubObjectUrl(vi.fn(() => 'blob:old-workspace'), vi.fn());
        factory.getFileBlob.mockResolvedValue(new Blob(['workspace-a'], { type: 'image/png' }));
        const wrapper = await mountViewer(makeMeta('displayed-preview'));
        await flushPromises();
        expect(wrapper.get('img').attributes('src')).toBe('blob:old-workspace');
        setActiveWorkspaceDb('viewer-isolation-b');
        await flushPromises();
        expect(wrapper.find('img').exists()).toBe(false);
        wrapper.unmount();
    });

    it('discards an old cached-load continuation even after switching away and back', async () => {
        stubObjectUrl(vi.fn(() => 'blob:old-workspace'), vi.fn());
        factory.getFileBlob.mockResolvedValue(new Blob(['workspace-a'], { type: 'image/png' }));
        const wrapper = await mountViewer(makeMeta('cached-continuation'));
        await flushPromises();
        // load() can await an already resolved cache hit. Invalidation must
        // still fence its continuation, even when the workspace ID is restored.
        const loading = (wrapper.vm as unknown as { load(): Promise<void> }).load();
        setActiveWorkspaceDb('viewer-isolation-b');
        setActiveWorkspaceDb('viewer-isolation-a');
        await loading;
        await flushPromises();
        expect(wrapper.find('img').exists()).toBe(false);
    });

    it('fetches a new blob when opening a different hash', async () => {
        const createObjectURL = vi.fn(
            () => `blob://viewer-${createObjectURL.mock.calls.length}`
        );
        const revokeObjectURL = vi.fn();
        stubObjectUrl(createObjectURL, revokeObjectURL);

        factory.getFileBlob.mockImplementation(
            async (hash: string) => new Blob([hash], { type: 'image/png' })
        );

        const metaA = makeMeta('viewer-a');
        const metaB = makeMeta('viewer-b');
        const wrapper = await mountViewer(metaA, true);

        await flushPromises();
        await flushPromises();

        expect(factory.getFileBlob).toHaveBeenCalledTimes(1);

        await wrapper.setProps({ meta: metaB });
        await flushPromises();
        await flushPromises();

        expect(factory.getFileBlob).toHaveBeenCalledTimes(2);
        expect(createObjectURL).toHaveBeenCalledTimes(2);
        expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    });
});
