import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createDocumentRevision } from '~/db/document-revisions';

vi.mock('~/composables/useIcon', () => ({ useIcon: (name: string) => ref(name) }));
import DocumentHistoryPanel from '../DocumentHistoryPanel.vue';

const Button = defineComponent({
    props: ['label'], emits: ['click'],
    template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>',
});
let wrapper: VueWrapper | undefined;
const workspaces: Array<{ id: string; name: string }> = [];

afterEach(async () => {
    wrapper?.unmount(); wrapper = undefined;
    setActiveWorkspaceDb(null);
    for (const { id, name } of workspaces.splice(0)) {
        evictWorkspaceDb(id);
        await Dexie.delete(name);
    }
    vi.unstubAllGlobals();
});

describe('mounted checkpoint history workspace isolation', () => {
    it('offers read-only checkpoint previews without write controls', async () => {
        vi.stubGlobal('CompressionStream', undefined);
        const id = `history-readonly-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(id);
        workspaces.push({ id, name: db.name });
        await createDocumentRevision({ documentId: 'history-document', title: 'Preserved', source: 'manual',
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Earlier content' }] }] } });
        wrapper = shallowMount(DocumentHistoryPanel, {
            props: { documentId: 'history-document', readOnly: true },
            global: { directives: { theme: () => {} }, stubs: { UButton: Button, UBadge: true }, renderStubDefaultSlot: true },
        });
        await vi.waitFor(() => expect(wrapper!.findAll('.revision-item')).toHaveLength(1));
        expect(wrapper.text()).not.toContain('Create checkpoint');
        await wrapper.get('.revision-item').trigger('click');
        expect(wrapper.get('.preview-body').text()).toContain('Earlier content');
        expect(wrapper.emitted('restore')).toBeUndefined();
    });
    it('clears an A preview and reloads B history in a retained same-ID panel', async () => {
        // Real identity codec for the test DOM's Blob implementation.
        vi.stubGlobal('CompressionStream', undefined);
        const idA = `history-a-${crypto.randomUUID()}`;
        const idB = `history-b-${crypto.randomUUID()}`;
        for (const [id, title, text] of [
            [idA, 'A private checkpoint', 'A private checkpoint body'],
            [idB, 'B owner checkpoint', 'B owner checkpoint body'],
        ] as const) {
            const db = setActiveWorkspaceDb(id);
            workspaces.push({ id, name: db.name });
            await createDocumentRevision({
                documentId: 'copied-document', title, source: 'manual',
                content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
            });
        }
        setActiveWorkspaceDb(idA);
        wrapper = shallowMount(DocumentHistoryPanel, {
            props: { documentId: 'copied-document', createCheckpoint: async () => {} },
            global: { directives: { theme: () => {} }, stubs: { UButton: Button, UBadge: true }, renderStubDefaultSlot: true },
        });
        await vi.waitFor(() => expect(wrapper!.findAll('.revision-item')).toHaveLength(1));
        await wrapper.get('.revision-item').trigger('click');
        expect(wrapper.get('.preview-body').text()).toContain('A private checkpoint body');
        setActiveWorkspaceDb(idB);
        await nextTick();
        expect(wrapper.find('.preview-body').exists()).toBe(false);
        await vi.waitFor(() => expect(wrapper!.findAll('.revision-item')).toHaveLength(1));
        await wrapper.get('.revision-item').trigger('click');
        expect(wrapper.get('.preview-body').text()).toContain('B owner checkpoint body');
        expect(wrapper.text()).not.toContain('A private checkpoint body');
    });
});
