import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

/**
 * Convert message Markdown into the TipTap JSON shape stored by documents.
 *
 * These imports intentionally stay static. This conversion is a core message
 * action, and deferring the editor dependencies left the action vulnerable to
 * stale or cleared Vite optimizer chunks in development.
 */
export function markdownToTipTapDoc(source: string): JSONContent {
    const markdown = source.trim();
    if (!markdown) return { type: 'doc', content: [] };

    const editor = new Editor({
        extensions: [StarterKit, Markdown],
        content: markdown,
    });

    try {
        const document = editor.getJSON();
        if (document.type !== 'doc') {
            throw new Error('Markdown conversion did not produce a document');
        }
        return document;
    } finally {
        editor.destroy();
    }
}
