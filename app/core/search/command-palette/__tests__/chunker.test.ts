import { describe, expect, it } from 'vitest';
import {
    ResourceChunkTracker,
    buildChunkPlan,
    chunkText,
    resourceToIndexDocuments,
    stableChunkId,
} from '../chunker';
import type { PaletteResource } from '../types';

function resource(content: string): PaletteResource {
    return {
        key: 'doc:1',
        sourceId: 'document',
        categoryId: 'document',
        recordId: '1',
        title: 'Doc',
        content,
        revision: 'r1',
        primaryAction: {
            id: 'open',
            label: 'Open',
            target: {
                kind: 'document',
                documentId: '1',
                destination: 'active',
            },
        },
    };
}

describe('chunker', () => {
    it('returns single chunk for small content', () => {
        expect(chunkText('hello', { size: 100, overlap: 10 })).toEqual([
            'hello',
        ]);
        expect(chunkText('', { size: 100, overlap: 10 })).toEqual(['']);
    });

    it('splits with overlap and prefers whitespace boundaries', () => {
        const text = `${'word '.repeat(50)}boundary ${'word '.repeat(50)}`;
        const chunks = chunkText(text, { size: 80, overlap: 20 });
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0]!.length).toBeLessThanOrEqual(80);
        // Overlap means later chunk starts before previous end
        const joined = chunks.join('');
        expect(joined.includes('boundary')).toBe(true);
    });

    it('uses stable chunk ids from source/record/revision/index', () => {
        expect(stableChunkId('document', '1', 'r1', 0)).toBe(
            'document:1:r1:0'
        );
        const plans = buildChunkPlan(resource('a'.repeat(10)), {
            size: 4,
            overlap: 1,
        });
        expect(plans[0]?.id).toBe('document:1:r1:0');
    });

    it('tracks replace and remove per resource without affecting others', () => {
        const tracker = new ResourceChunkTracker();
        tracker.set('doc:1', ['a', 'b']);
        tracker.set('doc:2', ['c']);
        expect(tracker.remove('doc:1')).toEqual(['a', 'b']);
        expect(tracker.get('doc:2')).toEqual(['c']);
        tracker.set('doc:2', ['d']);
        expect(tracker.get('doc:2')).toEqual(['d']);
    });

    it('builds index documents for a resource', () => {
        const docs = resourceToIndexDocuments(resource('hello world'));
        expect(docs).toHaveLength(1);
        expect(docs[0]?.title).toBe('Doc');
        expect(docs[0]?.body).toBe('hello world');
    });

    it('rejects chunk options that cannot advance', () => {
        expect(() => chunkText('abcdef', { size: 0, overlap: 0 })).toThrow(
            RangeError
        );
        expect(() => chunkText('abcdef', { size: 4, overlap: 4 })).toThrow(
            RangeError
        );
        expect(() => chunkText('abcdef', { size: 4, overlap: 5 })).toThrow(
            RangeError
        );
        expect(() => chunkText('abcdef', { size: 4, overlap: -1 })).toThrow(
            RangeError
        );
    });
});
