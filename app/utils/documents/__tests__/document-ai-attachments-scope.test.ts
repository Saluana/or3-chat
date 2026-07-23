import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
    MAX_DOCUMENT_AI_ATTACHMENTS,
    validateDocumentAiAttachment,
    validateDocumentAiAttachments,
} from '../document-ai-attachments';
import { resolveDocumentAiScopeRange } from '../document-ai-scope';

describe('document AI attachment revalidation', () => {
    it('accepts well-formed image and pdf data URLs', () => {
        expect(() => validateDocumentAiAttachment({
            name: 'shot.png',
            mime: 'image/png',
            kind: 'image',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
        })).not.toThrow();
        expect(() => validateDocumentAiAttachment({
            name: 'doc.pdf',
            mime: 'application/pdf',
            kind: 'pdf',
            dataUrl: 'data:application/pdf;base64,JVBERi0=',
        })).not.toThrow();
    });

    it('rejects forged mime, non-data schemes, and empty payloads', () => {
        expect(() => validateDocumentAiAttachment({
            name: 'evil.png',
            mime: 'image/png',
            kind: 'image',
            dataUrl: 'https://evil.example/x.png',
        })).toThrow(/data:/iu);
        expect(() => validateDocumentAiAttachment({
            name: 'mismatch.png',
            mime: 'image/png',
            kind: 'pdf',
            dataUrl: 'data:application/pdf;base64,JVBERi0=',
        })).toThrow(/mime/iu);
        expect(() => validateDocumentAiAttachment({
            name: 'empty.png',
            mime: 'image/png',
            kind: 'image',
            dataUrl: 'data:image/png;base64,',
        })).toThrow(/empty/iu);
        expect(() => validateDocumentAiAttachments(Array.from({ length: MAX_DOCUMENT_AI_ATTACHMENTS + 1 }, (_, index) => ({
            name: `f${index}.png`,
            mime: 'image/png',
            kind: 'image' as const,
            dataUrl: 'data:image/png;base64,aGVsbG8=',
        })))).toThrow(/up to/iu);
    });
});

describe('document AI scope range', () => {
    let editor: Editor | undefined;
    afterEach(() => editor?.destroy());

    function makeEditor() {
        editor = new Editor({
            extensions: [StarterKit],
            content: {
                type: 'doc',
                content: [
                    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
                    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Two' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] },
                ],
            },
        });
        return editor;
    }

    it('highlights the current section from heading through the next peer heading', () => {
        const current = makeEditor();
        // Caret in "Alpha" paragraph (second top-level node).
        const alphaPos = 1 + current.state.doc.firstChild!.nodeSize + 1;
        current.commands.setTextSelection(alphaPos);
        const range = resolveDocumentAiScopeRange(current, 'section');
        expect(range?.mode).toBe('block');
        expect(current.state.doc.textBetween(range!.from, range!.to, '\n')).toContain('One');
        expect(current.state.doc.textBetween(range!.from, range!.to, '\n')).toContain('Alpha');
        expect(current.state.doc.textBetween(range!.from, range!.to, '\n')).not.toContain('Beta');
    });

    it('uses an inline range for selection scope and the full doc for document scope', () => {
        const current = makeEditor();
        current.commands.setTextSelection({ from: 2, to: 5 });
        const selection = resolveDocumentAiScopeRange(current, 'selection');
        expect(selection).toEqual({ from: 2, to: 5, mode: 'inline' });

        const documentRange = resolveDocumentAiScopeRange(current, 'document');
        expect(documentRange?.mode).toBe('block');
        expect(documentRange?.from).toBe(0);
        expect(documentRange?.to).toBe(current.state.doc.content.size);
    });

    it('limits heading-less section scope to the caret block, not the whole document', () => {
        editor = new Editor({
            extensions: [StarterKit],
            content: {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Third' }] },
                ],
            },
        });
        const secondFrom = editor.state.doc.firstChild!.nodeSize;
        editor.commands.setTextSelection(secondFrom + 2);
        const range = resolveDocumentAiScopeRange(editor, 'section');
        expect(range?.mode).toBe('block');
        expect(editor.state.doc.textBetween(range!.from, range!.to, '\n')).toBe('Second');
        expect(editor.state.doc.textBetween(range!.from, range!.to, '\n')).not.toContain('First');
        expect(editor.state.doc.textBetween(range!.from, range!.to, '\n')).not.toContain('Third');
    });
});
