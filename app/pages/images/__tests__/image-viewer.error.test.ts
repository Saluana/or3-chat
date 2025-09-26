import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { FileMeta } from '~/db/schema';

const factory = vi.hoisted(() => {
    const toastAdd = vi.fn();
    const getFileBlob = vi.fn();
    const reportError = vi.fn();
    return { toastAdd, getFileBlob, reportError };
});

vi.mock('#imports', () => ({ useToast: () => ({ add: factory.toastAdd }) }));
vi.mock('~/db/files', () => ({ getFileBlob: factory.getFileBlob }));
vi.mock('~/utils/errors', () => ({ reportError: factory.reportError }));
vi.mock('@vueuse/core', () => ({ onKeyStroke: vi.fn() }));

const ModalStub = defineComponent({
    name: 'ModalStub',
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});

const makeMeta = (hash: string): FileMeta => ({
    hash,
    name: `Image ${hash}`,
    mime_type: 'image/png',
    kind: 'image',
    size_bytes: 256,
    width: 32,
    height: 32,
    page_count: undefined,
    ref_count: 0,
    created_at: 1,
    updated_at: 2,
    deleted: false,
    clock: 0,
});

describe('ImageViewer error handling', () => {
    beforeEach(() => {
        factory.toastAdd.mockReset();
        factory.getFileBlob.mockReset();
        factory.reportError.mockReset();
    });

    it('reports when viewer blob fetch fails', async () => {
        factory.getFileBlob.mockRejectedValueOnce(new Error('missing'));
        const ImageViewer = (await import('../ImageViewer.vue')).default;
        const meta = makeMeta('viewer');
        mount(ImageViewer, {
            props: { modelValue: true, meta },
            global: {
                stubs: {
                    UModal: ModalStub,
                    UButton: true,
                    UButtonGroup: true,
                    UIcon: true,
                    teleport: true,
                },
            },
        });

        await flushPromises();
        await flushPromises();

        expect(factory.reportError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                code: 'ERR_DB_READ_FAILED',
                tags: expect.objectContaining({
                    action: 'viewer-load',
                    hash: 'viewer',
                }),
            })
        );
    });
});
