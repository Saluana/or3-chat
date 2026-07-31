import { describe, expect, it } from 'vitest';
import { collectDocumentFileHashes } from '../document-content';

describe('document file hash extraction', () => {
    it('collects and deduplicates offline image hashes recursively', () => {
        expect(collectDocumentFileHashes({
            type: 'doc',
            content: [
                { type: 'or3Image', attrs: { hash: 'sha256:first' } },
                { type: 'blockquote', content: [{ type: 'image', attrs: { hash: 'sha256:second' } }] },
                { type: 'or3Image', attrs: { hash: 'sha256:first' } },
            ],
        })).toEqual(['sha256:first', 'sha256:second']);
    });
});
