import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    effectScope,
    nextTick,
    ref,
    type EffectScope,
    type Ref,
} from 'vue';
import type { ImageSummary } from '~/db/files-select';

const searchState = vi.hoisted(() => ({
    corpus: [] as Array<{ id: string; name: string; mime: string }>,
    calls: [] as Array<{ term: string; limit: number; offset: number }>,
    fail: false,
    emptyHits: false,
    hitsOverride: null as Array<{
        id: string;
        name: string;
        mime: string;
    }> | null,
    delays: new Map<string, Promise<void>>(),
    buildGates: [] as Array<Promise<void>>,
    builds: [] as string[][],
}));

function tokenize(value: string): string[] {
    return value
        .toLocaleLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

vi.mock('~/core/search/orama', () => ({
    createDb: vi.fn(async () => ({ id: 'fake' })),
    buildIndex: vi.fn(async (_db: unknown, docs: Array<{ id: string }>) => {
        searchState.builds.push(docs.map((doc) => doc.id));
        const gate = searchState.buildGates.shift();
        if (gate) await gate;
    }),
    searchWithIndex: vi.fn(
        async (
            _db: unknown,
            term: string,
            limit = 100,
            options?: { offset?: number }
        ) => {
            const offset = options?.offset ?? 0;
            searchState.calls.push({ term, limit, offset });
            const delay = searchState.delays.get(term);
            if (delay) await delay;
            if (searchState.fail) throw new Error('orama failed');
            if (searchState.emptyHits) return { hits: [] };
            if (searchState.hitsOverride) {
                return {
                    hits: searchState.hitsOverride.map((doc) => ({
                        document: { id: doc.id },
                    })),
                };
            }
            const terms = tokenize(term);
            const matched = searchState.corpus
                .filter((doc) => {
                    const haystack = new Set(
                        tokenize(`${doc.name} ${doc.mime}`)
                    );
                    return (
                        terms.length > 0 &&
                        terms.every((token) => haystack.has(token))
                    );
                })
                .slice(offset, offset + limit);
            return {
                hits: matched.map((doc) => ({ document: { id: doc.id } })),
            };
        }
    ),
}));

import { useImageSearch } from '../useImageSearch';

function summary(id: string, name: string): ImageSummary {
    return {
        hash: id,
        name,
        mime_type: 'image/png',
        created_at: 1,
        size_bytes: 1,
        state: 'active',
    };
}

describe('useImageSearch', () => {
    let scope: EffectScope;
    let summaries: Ref<ImageSummary[]>;

    beforeEach(() => {
        (process as unknown as { client?: boolean }).client = true;
        searchState.corpus = [];
        searchState.calls = [];
        searchState.fail = false;
        searchState.emptyHits = false;
        searchState.hitsOverride = null;
        searchState.delays.clear();
        searchState.buildGates = [];
        searchState.builds = [];
        scope = effectScope();
    });

    afterEach(() => {
        scope.stop();
    });

    it('retrieves matches beyond the 200-hit batch in offset batches', async () => {
        const docs = Array.from({ length: 450 }, (_, index) => ({
            id: `h${String(index).padStart(3, '0')}`,
            name: `photo-${index}.png`,
            mime: 'image/png',
        }));
        searchState.corpus = docs;
        summaries = ref(docs.map((doc) => summary(doc.id, doc.name)));

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'photo';
        await nextTick();
        await search.search();

        expect(search.status.value).toBe('ready');
        expect(search.matches.value?.size).toBe(450);
        expect(search.matches.value?.has('h449')).toBe(true);
        const offsets = searchState.calls
            .filter((call) => call.term === 'photo')
            .map((call) => call.offset);
        expect(offsets).toEqual([0, 200, 400]);
        expect(
            searchState.calls.every((call) => call.limit === 200)
        ).toBe(true);
    });

    it('falls back to a whole-corpus substring scan when Orama fails', async () => {
        const docs = [
            { id: 'h1', name: 'sunset-beach.png', mime: 'image/png' },
            { id: 'h2', name: 'mountain.png', mime: 'image/png' },
            { id: 'h3', name: 'beach-party.gif', mime: 'image/gif' },
        ];
        searchState.corpus = docs;
        searchState.fail = true;
        summaries = ref(docs.map((doc) => summary(doc.id, doc.name)));

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'beach';
        await nextTick();
        await search.search();

        expect(search.status.value).toBe('ready');
        expect([...(search.matches.value ?? [])].sort()).toEqual(['h1', 'h3']);
    });

    it('falls back when Orama has zero hits but the corpus matches', async () => {
        const docs = [
            { id: 'h1', name: 'sunset-beach.png', mime: 'image/png' },
            { id: 'h2', name: 'mountain.png', mime: 'image/png' },
        ];
        searchState.corpus = docs;
        searchState.emptyHits = true;
        summaries = ref(docs.map((doc) => summary(doc.id, doc.name)));

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'beach';
        await nextTick();
        await search.search();

        expect([...(search.matches.value ?? [])]).toEqual(['h1']);
    });

    it('drops stale search completions when the query changes', async () => {
        const docs = [
            { id: 'a1', name: 'alpha.png', mime: 'image/png' },
            { id: 'b1', name: 'beta.png', mime: 'image/png' },
        ];
        searchState.corpus = docs;
        summaries = ref(docs.map((doc) => summary(doc.id, doc.name)));

        let releaseFirst: () => void = () => undefined;
        searchState.delays.set(
            'alpha',
            new Promise<void>((resolve) => {
                releaseFirst = resolve;
            })
        );

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'alpha';
        const firstRun = search.search();
        await nextTick();
        search.query.value = 'beta';
        await nextTick();
        const secondRun = await search.search();
        releaseFirst();
        await firstRun;
        await secondRun;

        expect([...(search.matches.value ?? [])]).toEqual(['b1']);
        expect(search.status.value).toBe('ready');
    });

    it('clears matches when the query is emptied', async () => {
        const docs = [{ id: 'a1', name: 'alpha.png', mime: 'image/png' }];
        searchState.corpus = docs;
        summaries = ref(docs.map((doc) => summary(doc.id, doc.name)));

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'alpha';
        await nextTick();
        await search.search();
        expect(search.matches.value).not.toBeNull();

        search.query.value = '';
        await nextTick();
        expect(search.matches.value).toBeNull();
        expect(search.status.value).toBe('idle');
    });

    it('ignores hits for rows missing from the corpus', async () => {
        searchState.corpus = [
            { id: 'known', name: 'photo.png', mime: 'image/png' },
        ];
        searchState.hitsOverride = [
            { id: 'known', name: 'photo.png', mime: 'image/png' },
            { id: 'ghost', name: 'photo-deleted.png', mime: 'image/png' },
        ];
        summaries = ref([summary('known', 'photo.png')]);

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'photo';
        await nextTick();
        await search.search();

        expect([...(search.matches.value ?? [])]).toEqual(['known']);
    });

    it('awaits an in-flight index build instead of publishing fallback results', async () => {
        let releaseBuild: () => void = () => undefined;
        searchState.buildGates.push(
            new Promise<void>((resolve) => {
                releaseBuild = resolve;
            })
        );
        // Tokenized Orama search matches this query; the raw substring
        // fallback cannot, which exposes premature fallback publication.
        searchState.corpus = [
            { id: 'h1', name: 'foo.bar.png', mime: 'image/png' },
        ];
        summaries = ref([summary('h1', 'foo.bar.png')]);

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'foo bar';
        await nextTick();
        const firstRun = search.search();
        const secondRun = search.search();
        await Promise.resolve();
        releaseBuild();
        await firstRun;
        await secondRun;

        expect(search.status.value).toBe('ready');
        expect([...(search.matches.value ?? [])]).toEqual(['h1']);
        // The two searches share one build for the same corpus.
        expect(searchState.builds).toHaveLength(1);
    });

    it('rebuilds the latest corpus and discards obsolete builds', async () => {
        let releaseFirstBuild: () => void = () => undefined;
        searchState.buildGates.push(
            new Promise<void>((resolve) => {
                releaseFirstBuild = resolve;
            })
        );
        searchState.corpus = [
            { id: 'a1', name: 'alpha.png', mime: 'image/png' },
        ];
        summaries = ref([summary('a1', 'alpha.png')]);

        const search = scope.run(() => useImageSearch(summaries))!;
        search.query.value = 'beta';
        await nextTick();
        const firstRun = search.search();
        await Promise.resolve();

        // Corpus changes while the first build is still constructing.
        searchState.corpus = [
            { id: 'b1', name: 'beta.png', mime: 'image/png' },
        ];
        summaries.value = [summary('b1', 'beta.png')];
        await nextTick();
        const secondRun = search.search();
        await secondRun;
        releaseFirstBuild();
        await firstRun;
        await nextTick();

        expect([...(search.matches.value ?? [])]).toEqual(['b1']);

        // The obsolete build must not replace the latest index: alpha no
        // longer exists in the corpus.
        search.query.value = 'alpha';
        await nextTick();
        await search.search();
        expect([...(search.matches.value ?? [])]).toEqual([]);
    });
});
