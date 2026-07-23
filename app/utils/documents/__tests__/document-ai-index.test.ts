import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { freezeDocumentForAi } from '../document-ai-operations';
import {
    buildDocumentOutline,
    chunkDocumentBlocks,
    clampDocumentAiChunkWords,
    DEFAULT_DOCUMENT_AI_CHUNK_WORDS,
    searchFrozenDocument,
    summarizeOutlineForPrompt,
} from '../document-ai-index';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function words(count: number, prefix = 'word') {
    return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

function makeEditor() {
    editor = new Editor({
        extensions: [StarterKit],
        content: {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Alpha' }] },
                { type: 'paragraph', content: [{ type: 'text', text: words(400) }] },
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Beta' }] },
                { type: 'paragraph', content: [{ type: 'text', text: `findme later ${words(400, 'tail')}` }] },
            ],
        },
    });
    return editor;
}

describe('document AI index helpers', () => {
    it('defaults chunk size to 5000 words and clamps extremes', () => {
        expect(DEFAULT_DOCUMENT_AI_CHUNK_WORDS).toBe(5000);
        expect(clampDocumentAiChunkWords(100)).toBe(500);
        expect(clampDocumentAiChunkWords(50_000)).toBe(20_000);
        expect(clampDocumentAiChunkWords('2500')).toBe(2500);
    });

    it('builds outline entries and chunk ranges', () => {
        const snapshot = freezeDocumentForAi(makeEditor());
        const outline = buildDocumentOutline(snapshot);
        expect(outline[0]?.title).toBe('Alpha');
        expect(summarizeOutlineForPrompt(outline)).toContain('b1');

        // Min clamp is 500 words — use that budget with ~800-word doc to force multiple chunks.
        const chunks = chunkDocumentBlocks(snapshot.blocks, 500);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0]?.fromRef).toBe('b1');
    });

    it('searches frozen document text', () => {
        const snapshot = freezeDocumentForAi(makeEditor());
        const matches = searchFrozenDocument(snapshot, 'findme');
        expect(matches).toEqual([
            expect.objectContaining({ ref: 'b4', snippet: expect.stringContaining('findme') }),
        ]);
    });
});
