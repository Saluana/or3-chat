import { Editor, getSchema, type JSONContent } from '@tiptap/core';
import { Markdown } from 'tiptap-markdown';
import { loadDocumentEditorExtensions } from './document-editor-schema';

/** Export with the same registered nodes and marks used by native documents. */
export async function documentToMarkdown(content: JSONContent): Promise<string> {
    const extensions = [...await loadDocumentEditorExtensions(), Markdown];
    getSchema(extensions).nodeFromJSON(content).check();
    const editor = new Editor({ extensions, content, editable: false });
    try {
        return editor.storage.markdown.getMarkdown();
    } finally {
        editor.destroy();
    }
}
