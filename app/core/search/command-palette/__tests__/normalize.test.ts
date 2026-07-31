import { describe, expect, it } from 'vitest';
import {
    isIndexablePostType,
    normalizeScalarMetadata,
    tiptapToPlainText,
} from '../normalize';

describe('normalize', () => {
    it('extracts TipTap plain text with block boundaries', () => {
        const doc = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Hello' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'World' }],
                },
            ],
        };
        expect(tiptapToPlainText(doc)).toBe('Hello\nWorld');
        expect(tiptapToPlainText(JSON.stringify(doc))).toBe('Hello\nWorld');
    });

    it('falls back to raw string for malformed JSON', () => {
        expect(tiptapToPlainText('{not-json')).toBe('{not-json');
    });

    it('handles empty content', () => {
        expect(tiptapToPlainText('')).toBe('');
        expect(tiptapToPlainText(null)).toBe('');
    });

    it('indexes scalar metadata allowlist only', () => {
        expect(
            normalizeScalarMetadata(
                { completed: true, nested: { a: 1 }, ignored: 'x' },
                ['completed', 'nested.a']
            )
        ).toEqual(['completed:true', 'nested.a:1']);
    });

    it('excludes internal post types', () => {
        expect(isIndexablePostType('doc')).toBe(true);
        expect(isIndexablePostType('or3:document-revision')).toBe(false);
    });
});
