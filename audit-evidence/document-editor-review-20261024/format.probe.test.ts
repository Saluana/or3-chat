import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { documentToMarkdown } from '~/utils/documents/document-to-markdown';
import { AutocompleteExtension } from '~/plugins/EditorAutocomplete/TiptapExtension';
import AutocompleteState from '~/plugins/EditorAutocomplete/state';
import { DocumentAiHunks } from '~/plugins/DocumentAiHunks/TiptapExtension';
import { freezeDocumentForAi } from '~/utils/documents/document-ai-operations';
import { createDocumentAiHunks } from '~/utils/documents/document-ai-hunks';
let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; AutocompleteState.value.isEnabled = true; });

it('reproduces a document image export without a usable image URL or embedded bytes', async () => {
    const markdown = await documentToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] }, { type: 'or3Image', attrs: { hash: 'sha256:synthetic-image', alt: 'Photo', width: 100 } }] });
    expect(markdown).toContain('Caption');
    expect(markdown).not.toMatch(/!\[[^\]]*\]\(|<img|data:image/u);
});

it('reproduces autocomplete ignoring the loading false timeout metadata', () => {
    editor = new Editor({ extensions: [StarterKit, AutocompleteExtension], content: '<p>Base</p>' });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const state = () => editor!.state.plugins.find(plugin => plugin.spec.key?.key.startsWith('autocomplete'))!.getState(editor!.state);
    editor.view.dispatch(editor.state.tr.setMeta('loading', true));
    expect(state().loading).toBe(true);
    editor.view.dispatch(editor.state.tr.setMeta('loading', false));
    expect(state().loading).toBe(true);
});

it('reproduces AI review buttons ignoring semantic click activation but accepting mousedown', () => {
    editor = new Editor({ extensions: [StarterKit, DocumentAiHunks], content: '<p>Base</p>' });
    const accepted = vi.fn();
    const snapshot = freezeDocumentForAi(editor);
    const hunks = createDocumentAiHunks([{ kind: 'insert_end', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Append' }] }] }], snapshot);
    editor.commands.setDocumentAiHunkHandlers({ onAcceptHunk: accepted });
    editor.commands.setDocumentAiHunks({ snapshot, hunks });
    const button = editor.view.dom.querySelector<HTMLButtonElement>('.document-ai-hunk-accept')!;
    expect(button).not.toBeNull();
    button.click();
    expect(accepted).not.toHaveBeenCalled();
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(accepted).toHaveBeenCalledWith(hunks[0]!.id);
});
