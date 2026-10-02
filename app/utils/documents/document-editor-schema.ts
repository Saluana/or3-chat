import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Or3DocumentImage } from '~/extensions/or3-document-image';
import { DocumentAiHunks } from '~/plugins/DocumentAiHunks/TiptapExtension';
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';
import { listEditorExtensions, listEditorMarks, listEditorNodes } from '~/composables/editor/useEditorNodes';

/** Both the mounted editor and lazy chat validation use the same extension registry. */
export async function loadDocumentEditorExtensions() {
    const loaded = await loadEditorExtensions(listEditorNodes(), listEditorMarks(), listEditorExtensions());
    return [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        TaskList, TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: true } }),
        Or3DocumentImage, DocumentAiHunks,
        Placeholder.configure({
            placeholder: ({ node }) => node.type.name === 'heading' ? 'Heading' : "Write, or press '/' for commands…",
            showOnlyCurrent: true,
        }),
        ...loaded.extensions, ...loaded.nodes, ...loaded.marks,
    ];
}

export async function loadDocumentEditorSchema() {
    return getSchema(await loadDocumentEditorExtensions());
}
