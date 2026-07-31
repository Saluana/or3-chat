import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
    resolveAutomaticDocumentAiScope,
    seedEditableContext,
} from '../useDocumentAiAgent';
import { freezeDocumentForAi } from '~/utils/documents/document-ai-operations';

let editor: Editor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

function makeEditor(content: Record<string, unknown>) {
    editor = new Editor({
        extensions: [StarterKit],
        content,
    });
    return editor;
}

describe('automatic Document AI context', () => {
    it('keeps a selection as the strict target while seeding full small-document context', () => {
        const current = makeEditor({
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Overview' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Selected body and nearby context.' }],
                },
            ],
        });
        current.commands.setTextSelection({ from: 11, to: 19 });
        const snapshot = freezeDocumentForAi(current);
        const scope = resolveAutomaticDocumentAiScope(current);
        const seeded = seedEditableContext(current, snapshot, scope, 5000);
        const payload = JSON.parse(seeded.seedText);

        expect(scope).toBe('selection');
        expect(seeded.allowedRefs.size).toBe(0);
        expect(seeded.readableRefs.size).toBe(2);
        expect(payload.selection.text).toBeTruthy();
        expect(payload.cursor.blockRef).toBe('b2');
        expect(payload.documentBlocks).toHaveLength(2);
        expect(payload.note).toContain('only writable target');
    });

    it('anchors large automatic document context at the cursor without seeding every block', () => {
        const content = Array.from({ length: 120 }, (_, index) => ({
            type: 'paragraph',
            content: [{
                type: 'text',
                text: `Block ${index + 1} contains enough words to make the document exceed the inline context budget.`,
            }],
        }));
        const current = makeEditor({ type: 'doc', content });
        current.commands.setTextSelection(current.state.doc.content.size - 2);
        const snapshot = freezeDocumentForAi(current);
        const scope = resolveAutomaticDocumentAiScope(current);
        const seeded = seedEditableContext(current, snapshot, scope, 500);
        const payload = JSON.parse(seeded.seedText);

        expect(scope).toBe('document');
        expect(seeded.allowedRefs.size).toBe(120);
        expect(seeded.readableRefs.size).toBe(120);
        expect(payload.cursor.blockRef).toBe('b120');
        expect(payload.documentBlocks).toBeUndefined();
        expect(payload.cursorContextBlocks.length).toBeGreaterThan(0);
        expect(payload.cursorContextBlocks.length).toBeLessThan(120);
        expect(payload.chunks.length).toBeGreaterThan(1);
    });
});
