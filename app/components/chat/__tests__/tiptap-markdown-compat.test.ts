import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';

const editors: Editor[] = [];

function createMarkdownEditor(content = '') {
    const editor = new Editor({
        content,
        extensions: [StarterKit, Markdown],
    });
    editors.push(editor);
    return editor;
}

function getMarkdown(editor: Editor): string {
    const storage = (
        editor.storage as unknown as { markdown: MarkdownStorage }
    ).markdown;
    return storage.getMarkdown();
}

afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

describe('tiptap-markdown compatibility', () => {
    it('round-trips the Markdown structures stored by message editing', () => {
        const source = [
            '# Heading',
            '',
            'Paragraph with **bold**, *italic*, [link](https://example.com), and `code`.',
            '',
            '- first',
            '- second',
            '',
            '1. one',
            '2. two',
            '',
            '> quote',
            '',
            '```ts',
            'const value = 1',
            '```',
        ].join('\n');

        const editor = createMarkdownEditor(source);

        expect(getMarkdown(editor)).toBe(source);
    });

    it('keeps text from unsupported inline HTML and handles empty documents', () => {
        const html = '<span data-kind="legacy">kept</span>';
        const editor = createMarkdownEditor(html);

        // StarterKit has no span node/mark, so the established behavior is to
        // retain its text without inventing a schema entry for the attributes.
        expect(getMarkdown(editor)).toBe('kept');

        editor.commands.clearContent();
        expect(getMarkdown(editor)).toBe('');
    });

    it('accepts Tiptap 3 command options and keeps undo and redo working', () => {
        const editor = createMarkdownEditor('# Original');

        editor.commands.setContent('Updated', { emitUpdate: false });
        expect(getMarkdown(editor)).toBe('Updated');

        const historyEditor = createMarkdownEditor('Updated');
        historyEditor.commands.setTextSelection(
            historyEditor.state.doc.content.size - 1
        );
        historyEditor.commands.insertContent(' text');
        expect(getMarkdown(historyEditor)).toBe('Updated text');

        expect(historyEditor.commands.undo()).toBe(true);
        expect(getMarkdown(historyEditor)).toBe('Updated');

        expect(historyEditor.commands.redo()).toBe(true);
        expect(getMarkdown(historyEditor)).toBe('Updated text');
    });
});
