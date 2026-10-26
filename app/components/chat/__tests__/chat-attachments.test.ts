import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import MessageAttachmentsGallery from '../MessageAttachmentsGallery.vue';

vi.mock('~/composables/useThemeResolver', () => ({ useThemeOverrides: () => ref({}) }));
vi.mock('~/db/files', () => ({
    getFileMeta: async () => ({ hash: 'pdf', kind: 'pdf', mime_type: 'application/pdf', name: 'retained.pdf' }),
    getFileBlob: async () => new Blob(['synthetic retained PDF'], { type: 'application/pdf' }),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('chat attachment retrieval', () => {
    it('downloads a saved PDF from the expanded message gallery with its filename', async () => {
        const create = vi.fn(() => 'blob:retained-pdf');
        vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = vi.fn(); });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.download).toBe('retained.pdf');
            expect(this.href).toBe('blob:retained-pdf');
        });
        const wrapper = mount(MessageAttachmentsGallery, { props: { hashes: ['pdf'] } });
        try {
            await flushPromises();
            const download = wrapper.findAll('button').find(button => button.text() === 'Download');
            expect(download).toBeDefined();
            await download!.trigger('click'); await flushPromises();
            expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); }
    });
});
