import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import MessageAttachmentsGallery from '../MessageAttachmentsGallery.vue';

import { ensureUiMessage } from '~/utils/chat/uiMessages';

vi.mock('~/composables/useThemeResolver', () => ({ useThemeOverrides: () => ref({}) }));
vi.mock('~/db/files', () => ({
    getFileMeta: async () => ({ hash: 'pdf', kind: 'pdf', mime_type: 'application/pdf', name: 'retained.pdf' }),
    getFileBlob: async () => new Blob(['synthetic retained PDF'], { type: 'application/pdf' }),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('chat attachment retrieval', () => {
    it('shows each saved name for a shared hash and downloads with the selected name', async () => {
        const message = ensureUiMessage({
            id: 'message', role: 'user', file_hashes: '["pdf"]',
            data: { attachments: [
                { type: 'application/pdf', url: 'pdf', name: 'first.pdf' },
                { type: 'application/pdf', url: 'pdf', name: 'second.pdf' },
            ] },
        });
        const selections = message.attachmentSelections ?? [];
        const wrapper = mount(MessageAttachmentsGallery, { props: {
            hashes: selections.map(selection => selection.hash),
            names: selections.map(selection => selection.name),
        } });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.download).toBe('second.pdf');
        });
        vi.stubGlobal('URL', class extends URL {
            static override createObjectURL = () => 'blob:retained-pdf';
            static override revokeObjectURL = vi.fn();
        });
        try {
            await flushPromises();
            expect(wrapper.findAll('.message-attachment-pdf-name').map(label => label.text()))
                .toEqual(['first.pdf', 'second.pdf']);
            await wrapper.findAll('button').filter(button => button.text() === 'Download')[1]!.trigger('click');
            await flushPromises();
            expect(click).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); }
    });

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
