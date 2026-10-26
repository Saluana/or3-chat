import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { MarkdownStorage } from 'tiptap-markdown';
import { StreamMarkdown } from 'streamdown-vue';
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

    it.each([
        { name: 'literal link syntax', source: '&#91;label&#93;(https://example.test)', formula: null },
        { name: 'display math', source: '\\[x^2\\] and &#91;label&#93;(https://example.test)', formula: '\\[x^2\\]' },
        { name: 'inline math', source: '\\(x^2\\) and &#91;label&#93;(https://example.test)', formula: '\\(x^2\\)' },
        { name: 'code containing math delimiters', source: '`\\[literal\\]` and &#91;label&#93;(https://example.test)', formula: null },
        { name: 'literal entities', source: '&amp;#91;literal&amp;#93; and &#91;label&#93;(https://example.test)', formula: null },
    ])('preserves literal Markdown alongside $name', async ({ source, formula }) => {
        const wrapper = mount(MessageEditor, { props: { modelValue: source } });
        const initialRendering = mount(StreamMarkdown, { props: { content: source, parseIncompleteMarkdown: false } });
        let reopened: VueWrapper | undefined;
        let rendered: VueWrapper | undefined;
        try {
            await flushPromises();
            const editor = getEditor(wrapper);
            editor.commands.insertContentAt(editor.state.doc.content.size - 1, { type: 'text', text: ' edited' });
            await vi.advanceTimersByTimeAsync(200);
            const saved = wrapper.emitted('update:modelValue')?.at(-1)?.[0];
            expect(saved).toEqual(expect.any(String));
            if (formula) expect(saved).toContain(formula);
            reopened = mount(MessageEditor, { props: { modelValue: saved as string } });
            await flushPromises();
            expect(getEditor(reopened).getText()).toBe(editor.getText());
            expect(getEditor(reopened).getText()).toContain('[label](https://example.test) edited');
            expect(getEditor(reopened).getHTML()).not.toContain('<a ');
            if (formula) {
                editor.commands.selectAll();
                const clipboard = new Map<string, string>();
                const copy = new Event('copy', { bubbles: true, cancelable: true });
                Object.defineProperty(copy, 'clipboardData', { value: {
                    clearData: () => clipboard.clear(),
                    setData: (type: string, value: string) => clipboard.set(type, value),
                } });
                editor.view.dom.dispatchEvent(copy);
                expect(clipboard.get('text/plain')).toContain(formula);
            }
            rendered = mount(StreamMarkdown, { props: { content: saved as string, parseIncompleteMarkdown: false } });
            await flushPromises();
            expect(rendered.findAll('.katex annotation').map(node => node.text()))
                .toEqual(initialRendering.findAll('.katex annotation').map(node => node.text()));
            expect(rendered.text()).toContain('[label](https://example.test) edited');
            expect(rendered.findAll('a').map(link => link.text())).not.toContain('label');
        } finally {
            rendered?.unmount();
            initialRendering.unmount();
            reopened?.unmount();
            wrapper.unmount();
        }
    });
});
