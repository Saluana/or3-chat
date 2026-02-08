import { describe, expect, it } from 'vitest';
import {
    mergeAssistantFileHashes,
    normalizeImagesParam,
    parseHashes,
} from '../attachments';

describe('attachments utilities', () => {
    describe('parseHashes', () => {
        it('parses arrays', () => {
            expect(parseHashes(['a', 'b', 1 as unknown as string])).toEqual(['a', 'b']);
        });

        it('parses JSON array strings', () => {
            expect(parseHashes('["a","b"]')).toEqual(['a', 'b']);
        });

        it('parses CSV strings', () => {
            expect(parseHashes('a, b ,c')).toEqual(['a', 'b', 'c']);
        });

        it('parses single strings', () => {
            expect(parseHashes('single-hash')).toEqual(['single-hash']);
        });

        it('returns empty for bad inputs', () => {
            expect(parseHashes('')).toEqual([]);
            expect(parseHashes('{bad-json')).toEqual(['{bad-json']);
            expect(parseHashes(123)).toEqual([]);
            expect(parseHashes(null)).toEqual([]);
        });
    });

    it('mergeAssistantFileHashes dedupes while preserving order', () => {
        expect(mergeAssistantFileHashes(['a', 'b', 'a'], ['b', 'c', 'd'])).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
    });

    it('normalizeImagesParam accepts strings/object variants and drops invalid entries', () => {
        const normalized = normalizeImagesParam([
            'https://example.com/a.png',
            { url: 'https://example.com/b.png', mime: 'image/png', hash: 'sha256:1' },
            { data: 'data:image/png;base64,abc' },
            { nope: 'x' },
            123,
        ]);

        expect(normalized).toEqual([
            { kind: 'image', src: 'https://example.com/a.png' },
            {
                kind: 'image',
                src: 'https://example.com/b.png',
                mime: 'image/png',
                hash: 'sha256:1',
            },
            { kind: 'image', src: 'data:image/png;base64,abc', mime: undefined, hash: undefined },
        ]);
    });
});
