import { describe, expect, it } from 'vitest';
import { groupHitsByResource } from '../group-hits';
import { buildEscapedSnippet } from '../snippets';
import type { PaletteIndexDocument, PaletteResource } from '../types';

function doc(
    overrides: Partial<PaletteIndexDocument> & {
        id: string;
        resourceKey: string;
    }
): PaletteIndexDocument {
    return {
        id: overrides.id,
        resourceKey: overrides.resourceKey,
        recordId: overrides.recordId ?? '1',
        title: overrides.title ?? 'Thread',
        subtitle: overrides.subtitle ?? '',
        keywords: overrides.keywords ?? '',
        body: overrides.body ?? '',
        updatedAt: overrides.updatedAt ?? 0,
        chunkIndex: overrides.chunkIndex ?? 0,
    };
}

describe('groupHitsByResource', () => {
    it('collapses multiple chunks into one resource with best snippet', () => {
        const resource: PaletteResource = {
            key: 'chat:t1',
            sourceId: 'chat',
            categoryId: 'chat',
            recordId: 't1',
            title: 'Trip planning',
            content: 'alpha beta secret phrase gamma',
            primaryAction: {
                id: 'open',
                label: 'Open',
                target: {
                    kind: 'chat',
                    threadId: 't1',
                    destination: 'active',
                },
            },
        };
        const results = groupHitsByResource(
            [
                {
                    score: 1,
                    document: doc({
                        id: '1',
                        resourceKey: 'chat:t1',
                        body: 'alpha beta',
                        chunkIndex: 0,
                    }),
                },
                {
                    score: 5,
                    document: doc({
                        id: '2',
                        resourceKey: 'chat:t1',
                        body: 'secret phrase here',
                        chunkIndex: 1,
                    }),
                },
            ],
            new Map([['chat:t1', resource]]),
            'secret'
        );
        expect(results).toHaveLength(1);
        expect(results[0]?.snippet).toContain('secret');
        expect(results[0]?.snippet).not.toContain('<');
    });

    it('returns markup-like content as inert plain text for the UI to escape', () => {
        expect(buildEscapedSnippet('before <b>match</b> after', 'match')).toBe(
            'before <b>match</b> after'
        );
    });
});
