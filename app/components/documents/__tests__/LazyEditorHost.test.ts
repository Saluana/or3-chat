import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LazyEditorHost from '../LazyEditorHost.vue';

vi.mock('../DocumentEditorRoot.vue', () => ({
    default: {
        name: 'DocumentEditorRoot',
        props: ['documentId', 'paneId', 'tabId'],
        emits: ['ready'],
        template: '<div class="mock-editor" :data-document-id="documentId" :data-pane-id="paneId" :data-tab-id="tabId">Mock Editor</div>',
    },
}));

describe('LazyEditorHost', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps the skeleton visible until the document editor is ready', async () => {
        const wrapper = mount(LazyEditorHost, {
            props: { documentId: 'doc1' },
        });
        const editor = wrapper.getComponent({ name: 'DocumentEditorRoot' });

        expect(wrapper.find('.document-editor-skeleton').exists()).toBe(true);
        expect(wrapper.get('.mock-editor').classes()).toContain('invisible');

        editor.vm.$emit('ready', 'stale-doc');
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.document-editor-skeleton').exists()).toBe(true);

        editor.vm.$emit('ready', 'doc1');
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.document-editor-skeleton').exists()).toBe(false);
        expect(wrapper.get('.mock-editor').classes()).not.toContain('invisible');
        expect(vi.getTimerCount()).toBe(0);

        wrapper.unmount();
    });

    it('hides the old document while switching in place', async () => {
        const wrapper = mount(LazyEditorHost, {
            props: { documentId: 'doc1', paneId: 'pane-a', tabId: 'tab-a' },
        });
        const editor = wrapper.getComponent({ name: 'DocumentEditorRoot' });
        const initialEditorElement = wrapper.get('.mock-editor').element;

        editor.vm.$emit('ready', 'doc1');
        await wrapper.vm.$nextTick();
        await wrapper.setProps({ documentId: 'doc2', tabId: 'tab-b' });

        expect(wrapper.get('.mock-editor').element).toBe(initialEditorElement);
        expect(wrapper.get('.mock-editor').attributes()).toMatchObject({
            'data-document-id': 'doc2',
            'data-pane-id': 'pane-a',
            'data-tab-id': 'tab-b',
        });
        expect(wrapper.find('.document-editor-skeleton').exists()).toBe(true);

        editor.vm.$emit('ready', 'doc1');
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.document-editor-skeleton').exists()).toBe(true);

        editor.vm.$emit('ready', 'doc2');
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.document-editor-skeleton').exists()).toBe(false);

        wrapper.unmount();
    });

    it('clears its timeout on unmount', () => {
        const wrapper = mount(LazyEditorHost, {
            props: { documentId: 'doc1' },
        });
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        wrapper.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
