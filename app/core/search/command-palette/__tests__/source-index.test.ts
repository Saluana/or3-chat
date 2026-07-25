import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaletteResource } from '../types';

const resources: PaletteResource[] = [
    {
        key: 'chat:1',
        sourceId: 'chat',
        categoryId: 'chat',
        recordId: '1',
        title: 'Unrelated title',
        content: 'unique body phrase alpha',
        updatedAt: 2,
        primaryAction: {
            id: 'open',
            label: 'Open',
            target: { kind: 'chat', threadId: '1', destination: 'active' },
        },
    },
    {
        key: 'chat:2',
        sourceId: 'chat',
        categoryId: 'chat',
        recordId: '2',
        title: 'alpha title',
        content: 'other content',
        updatedAt: 1,
        primaryAction: {
            id: 'open',
            label: 'Open',
            target: { kind: 'chat', threadId: '2', destination: 'active' },
        },
    },
];

describe('PaletteSourceIndex', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns grouped candidates through Orama path', async () => {
        vi.doMock('~/core/search/orama', () => ({
            createDb: vi.fn(async () => ({ id: 'db' })),
            insertDocumentsBatched: vi.fn(async () => undefined),
            removeDoc: vi.fn(async () => undefined),
            searchWithIndex: vi.fn(async () => ({
                hits: [
                    {
                        score: 10,
                        document: {
                            id: 'c1',
                            resourceKey: 'chat:1',
                            recordId: '1',
                            title: 'Unrelated title',
                            subtitle: '',
                            keywords: '',
                            body: 'unique body phrase alpha',
                            updatedAt: 2,
                            chunkIndex: 0,
                        },
                    },
                    {
                        score: 4,
                        document: {
                            id: 'c2',
                            resourceKey: 'chat:1',
                            recordId: '1',
                            title: 'Unrelated title',
                            subtitle: '',
                            keywords: '',
                            body: 'another alpha chunk',
                            updatedAt: 2,
                            chunkIndex: 1,
                        },
                    },
                ],
            })),
        }));

        const { PaletteSourceIndex } = await import('../source-index');
        const index = new PaletteSourceIndex('chat');
        await index.replaceAll(resources);
        const result = await index.search({ term: 'alpha' });
        expect(result.usingFallback).toBe(false);
        expect(result.results).toHaveLength(1);
        expect(result.results[0]?.key).toBe('chat:1');
        expect(result.results[0]?.snippet?.toLowerCase()).toContain('alpha');
    });

    it('falls back to substring matching when forced', async () => {
        vi.doMock('~/core/search/orama', () => ({
            createDb: vi.fn(async () => {
                throw new Error('orama down');
            }),
            insertDocumentsBatched: vi.fn(async () => undefined),
            removeDoc: vi.fn(async () => undefined),
            searchWithIndex: vi.fn(async () => {
                throw new Error('search fail');
            }),
        }));

        const { PaletteSourceIndex } = await import('../source-index');
        const index = new PaletteSourceIndex('chat');
        await index.replaceAll(resources);
        const result = await index.search({
            term: 'unique body',
            forceFallback: true,
        });
        expect(result.usingFallback).toBe(true);
        expect(result.results.some((r) => r.key === 'chat:1')).toBe(true);
    });

    it('paginates chunk hits until it has resource-diverse results', async () => {
        const manyResources = Array.from({ length: 9 }, (_, index) => ({
            ...resources[0]!,
            key: `chat:${index}`,
            recordId: String(index),
            title: `Thread ${index}`,
        }));
        const hit = (resourceIndex: number, chunkIndex: number) => ({
            score: 100 - resourceIndex,
            document: {
                id: `${resourceIndex}:${chunkIndex}`,
                resourceKey: `chat:${resourceIndex}`,
                recordId: String(resourceIndex),
                title: `Thread ${resourceIndex}`,
                subtitle: '',
                keywords: '',
                body: `alpha ${resourceIndex}`,
                updatedAt: resourceIndex,
                chunkIndex,
            },
        });
        const searchWithIndex = vi.fn(
            async (
                _db: unknown,
                _term: string,
                _limit: number,
                options?: { offset?: number }
            ) => ({
                hits:
                    (options?.offset ?? 0) === 0
                        ? Array.from({ length: 24 }, (_, index) => hit(0, index))
                        : Array.from({ length: 8 }, (_, index) =>
                              hit(index + 1, 0)
                          ),
            })
        );
        vi.doMock('~/core/search/orama', () => ({
            createDb: vi.fn(async () => ({ id: 'db' })),
            insertDocumentsBatched: vi.fn(async () => undefined),
            removeDoc: vi.fn(async () => undefined),
            searchWithIndex,
        }));

        const { PaletteSourceIndex } = await import('../source-index');
        const index = new PaletteSourceIndex('chat');
        await index.replaceAll(manyResources);
        const result = await index.search({ term: 'alpha', limit: 8 });

        expect(result.results).toHaveLength(8);
        expect(new Set(result.results.map((item) => item.key)).size).toBe(8);
        expect(searchWithIndex).toHaveBeenCalledTimes(2);
    });
});
