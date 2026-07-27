import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { MarkdownStorage } from 'tiptap-markdown';
import MessageEditor from '../MessageEditor.vue';

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({}),
}));

type MessageEditorVm = {
    editor: Editor | null;
};

function getEditor(wrapper: VueWrapper): Editor {
    const editor = (wrapper.vm as unknown as MessageEditorVm).editor;
    if (!editor) throw new Error('Message editor did not initialize');
    return editor;
}

function getMarkdown(editor: Editor): string {
    return (
        editor.storage as unknown as { markdown: MarkdownStorage }
    ).markdown.getMarkdown();
}

describe('MessageEditor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces user edits before updating the parent model', async () => {
        const wrapper = mount(MessageEditor, {
            props: { modelValue: 'Original' },
        });
        await flushPromises();

        getEditor(wrapper).commands.setContent('Edited');
        await nextTick();

        expect(wrapper.emitted('update:modelValue')).toBeUndefined();

        await vi.advanceTimersByTimeAsync(199);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1);
        expect(wrapper.emitted('update:modelValue')).toEqual([['Edited']]);

        wrapper.unmount();
    });

    it('synchronizes an authoritative parent replacement without emitting it back', async () => {
        const wrapper = mount(MessageEditor, {
            props: { modelValue: '# Original' },
        });
        await flushPromises();

        await wrapper.setProps({ modelValue: '# Replaced' });
        await nextTick();
        await vi.runAllTimersAsync();

        expect(getMarkdown(getEditor(wrapper))).toBe('# Replaced');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();

        wrapper.unmount();
    });

    it('cancels a queued local edit when the parent supplies a newer value', async () => {
        const wrapper = mount(MessageEditor, {
            props: { modelValue: 'Original' },
        });
        await flushPromises();

        getEditor(wrapper).commands.setContent('Stale local edit');
        await nextTick();
        await wrapper.setProps({ modelValue: 'Authoritative replacement' });
        await vi.runAllTimersAsync();

        expect(getMarkdown(getEditor(wrapper))).toBe(
            'Authoritative replacement'
        );
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();

        wrapper.unmount();
    });
});
