import type { JSONContent } from '@tiptap/core';
import type { MarkdownStorage } from 'tiptap-markdown';
import { loadDocumentEditorExtensions } from './document-editor-schema';

function hasMarkdownSerializer(storage: unknown): storage is Pick<MarkdownStorage, 'getMarkdown'> {
    return typeof storage === 'object' && storage !== null
        && 'getMarkdown' in storage && typeof storage.getMarkdown === 'function';
}

/** Export with the same registered nodes and marks used by native documents. */
export async function documentToMarkdown(content: JSONContent): Promise<string> {
    const [{ Editor, getSchema }, { Markdown }] = await Promise.all([
        import('@tiptap/core'),
        import('tiptap-markdown'),
    ]);
    const extensions = [...await loadDocumentEditorExtensions(), Markdown];
    getSchema(extensions).nodeFromJSON(content).check();
    const editor = new Editor({ extensions, content, editable: false });
    try {
        // Tiptap's native Markdown declaration shares this key with tiptap-markdown.
        const storage: unknown = editor.storage.markdown;
        if (!hasMarkdownSerializer(storage)) {
            throw new Error('Document Markdown serializer is unavailable');
        }
        return storage.getMarkdown();
    } finally {
        editor.destroy();
    }
}
