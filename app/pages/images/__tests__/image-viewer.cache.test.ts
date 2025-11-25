import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { makeMeta } from './test-utils';
import type { FileMeta } from '~/db/schema';

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
vi.mock('@vueuse/core', () => ({ onKeyStroke: factory.onKeyStroke }));

describe('ImageViewer preview cache reuse', () => {
    beforeEach(async () => {
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

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function mountViewer(meta: FileMeta | null, modelValue = true) {
        const ImageViewer = (await import('../ImageViewer.vue')).default;
        return mount(ImageViewer, {
            props: { modelValue, meta },
            global: {
                stubs: {
                    UModal: {
                        name: 'ModalStub',
                        template: '<div><slot /></div>',
                    },
                    UButton: true,
                    UButtonGroup: true,
                    UIcon: true,
                    teleport: true,
                },
            },
        });
    }

    it('reuses cached previews when reopening with the same hash', async () => {
        const createObjectURL = vi.fn(() => 'blob://viewer');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', {
            createObjectURL,
            revokeObjectURL,
        });

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

    it('fetches a new blob when opening a different hash', async () => {
        const createObjectURL = vi.fn(
            () => `blob://viewer-${createObjectURL.mock.calls.length}`
        );
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', {
            createObjectURL,
            revokeObjectURL,
        });

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
