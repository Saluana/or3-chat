import { describe, it, expect } from 'vitest';
import {
    parseHashes,
    mergeAssistantFileHashes,
    normalizeImagesParam,
} from '../../utils/files/attachments';

describe('attachments utils', () => {
    it('parseHashes handles array', () => {
        expect(parseHashes(['a', 'b'])).toEqual(['a', 'b']);
    });
    it('parseHashes handles JSON string', () => {
        expect(parseHashes('["x","y"]')).toEqual(['x', 'y']);
    });
    it('parseHashes handles comma list', () => {
        expect(parseHashes('a,b,c')).toEqual(['a', 'b', 'c']);
    });
    it('parseHashes handles single', () => {
        expect(parseHashes('solo')).toEqual(['solo']);
    });
    it('parseHashes tolerant malformed', () => {
        expect(parseHashes('{bad json')).toEqual(['{bad json']);
        expect(parseHashes('')).toEqual([]);
        expect(parseHashes(null)).toEqual([]);
    });
    it('mergeAssistantFileHashes dedupes and preserves order', () => {
        expect(
            mergeAssistantFileHashes(['a', 'b'], ['b', 'c', 'a', 'd'])
        ).toEqual(['a', 'b', 'c', 'd']);
    });
    it('normalizeImagesParam handles strings & objects', () => {
        expect(
            normalizeImagesParam([
                'http://x/img.png',
                {
                    url: 'data:image/png;base64,aaa',
                    mime: 'image/png',
                    hash: 'h1',
                },
            ])
        ).toEqual([
            { kind: 'image', src: 'http://x/img.png' },
            {
                kind: 'image',
                src: 'data:image/png;base64,aaa',
                mime: 'image/png',
                hash: 'h1',
            },
        ]);
    });
    it('normalizeImagesParam skips invalid', () => {
        expect(normalizeImagesParam([null, 42, { foo: 'bar' }])).toEqual([]);
    });
});
