import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { AutocompleteExtension } from '../TiptapExtension';
import AutocompleteState from '../state';
import { state as globalState } from '~/state/global';

const { openRouterStream } = vi.hoisted(() => ({
    openRouterStream: vi.fn(),
}));

vi.mock('~/utils/chat/openrouterStream', () => ({ openRouterStream }));

let editor: Editor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
    openRouterStream.mockReset();
    globalState.value.openrouterKey = null;
    localStorage.removeItem('openrouter_api_key');
});

function makeEditor() {
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
        element,
        extensions: [
            StarterKit,
            Placeholder.configure({ placeholder: 'Write something…' }),
            AutocompleteExtension,
        ],
        content: '<p>Earlier context</p><p></p>',
    });
    return editor;
}

describe('AutocompleteExtension decorations', () => {
    it('replaces the empty-node placeholder with one caret-anchored suggestion', () => {
        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        (current.commands as unknown as { setSuggestion: (value: string) => boolean })
            .setSuggestion('A clean continuation');

        const activeNode = current.view.dom.querySelector('.has-autocomplete-suggestion');
        const suggestion = current.view.dom.querySelector('.autocomplete-suggestion');
        expect(activeNode?.classList.contains('is-empty')).toBe(true);
        expect(suggestion?.querySelector('.autocomplete-suggestion__text')?.textContent)
            .toBe('A clean continuation');
        expect(suggestion?.querySelector('.autocomplete-suggestion__hint')?.textContent)
            .toBe('Tab');
        expect(current.view.dom.querySelectorAll('.autocomplete-suggestion')).toHaveLength(1);
    });

    it('does not render autocomplete in the middle of a text block', () => {
        const current = makeEditor();
        current.commands.setTextSelection(4);
        (current.commands as unknown as { setSuggestion: (value: string) => boolean })
            .setSuggestion('should stay hidden');

        expect(current.view.dom.querySelector('.autocomplete-suggestion')).toBeNull();
        expect(current.view.dom.querySelector('.has-autocomplete-suggestion')).toBeNull();
    });

    it('does not resurrect a legacy localStorage key after logout', async () => {
        openRouterStream.mockImplementation(async function* (params: { apiKey?: string | null }) {
            expect(params.apiKey).toBeNull();
            yield { type: 'text', text: '<next_line> suggestion</next_line>' };
        });
        AutocompleteState.value.isEnabled = true;
        globalState.value.openrouterKey = null;
        localStorage.setItem('openrouter_api_key', 'legacy-key');

        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        current.commands.insertContent('A');

        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(openRouterStream).toHaveBeenCalledTimes(1);
    });
});
