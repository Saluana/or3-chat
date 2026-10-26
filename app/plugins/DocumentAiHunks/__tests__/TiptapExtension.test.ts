import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DocumentAiHunks } from '../TiptapExtension';
import { freezeDocumentForAi } from '~/utils/documents/document-ai-operations';
import { createDocumentAiHunks } from '~/utils/documents/document-ai-hunks';
let editor: Editor;
afterEach(() => editor?.destroy());
it('activates Accept through semantic click, without accepting on pointer-down', () => {
    editor = new Editor({ extensions: [StarterKit, DocumentAiHunks], content: '<p>Base</p>' });
    const accept = vi.fn();
    const snapshot = freezeDocumentForAi(editor);
    const hunks = createDocumentAiHunks([{ kind: 'insert_end', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Append' }] }] }], snapshot);
    editor.commands.setDocumentAiHunkHandlers({ onAcceptHunk: accept });
    editor.commands.setDocumentAiHunks({ snapshot, hunks });
    const button = editor.view.dom.querySelector<HTMLButtonElement>('.document-ai-hunk-accept')!;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(accept).not.toHaveBeenCalled();
    button.click();
    expect(accept).toHaveBeenCalledExactlyOnceWith(hunks[0]!.id);
});

it.each(['block', 'selection'] as const)('preserves rich formatting in both sides of a %s review, including expansion', scope => {
    editor = new Editor({ extensions: [StarterKit, DocumentAiHunks], content: '<h2>Original <em>heading</em></h2><p>Body</p>' });
    if (scope === 'selection') editor.commands.setTextSelection({ from: 1, to: editor.state.doc.firstChild!.nodeSize - 1 });
    const snapshot = freezeDocumentForAi(editor);
    const content = [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Revised heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Bold words', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and plain words. '.repeat(30) }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>literal text</script>' }] }] }] },
    ];
    const operation = scope === 'block' ? { kind: 'replace_block' as const, ref: 'b1', content } : { kind: 'replace_selection' as const, content };
    editor.commands.setDocumentAiHunks({ snapshot, hunks: createDocumentAiHunks([operation], snapshot) });
    const before = editor.view.dom.querySelector('.is-before .document-ai-hunk-pane-text')!;
    const after = editor.view.dom.querySelector('.is-after .document-ai-hunk-pane-text')!;
    expect(before.querySelector('h2 em')?.textContent).toBe('heading');
    expect(after.querySelector('h2')?.textContent).toBe('Revised heading');
    expect(after.querySelector('p strong')?.textContent).toBe('Bold words');
    expect(after.querySelector('ul li p')?.textContent).toBe('<script>literal text</script>');
    expect(after.querySelector('script')).toBeNull();
    const toggle = editor.view.dom.querySelector<HTMLButtonElement>('.document-ai-hunk-toggle')!;
    editor.view.dom.querySelector<HTMLElement>('.document-ai-hunk')!.scrollIntoView = vi.fn();
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(after.querySelector('h2')?.textContent).toBe('Revised heading');
    toggle.click();
    expect(after.querySelector('p strong')?.textContent).toBe('Bold words');
});
