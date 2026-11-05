import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import type { Thread } from '~/db/schema';
import { searchWithIndex } from '~/core/search/orama';
import { useThreadSearch } from '../useThreadSearch';

vi.mock('~/core/search/orama', async importOriginal => {
    const real = await importOriginal<typeof import('~/core/search/orama')>();
    return { ...real, searchWithIndex: vi.fn(real.searchWithIndex) };
});
const scopes: EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks(); });
const row = (id: string, title: string) => ({ id, title, updated_at: 1, deleted: false }) as Thread;
function setup(rows: Thread[]) {
    const threads = ref(rows);
    const scope = effectScope(); scopes.push(scope);
    return { threads, search: scope.run(() => useThreadSearch(threads))! };
}

// Failure cases: callers contaminate each other's indexes, same-second edits
// keep matching old titles, tombstones stay visible, and old query failures win.
describe('thread search freshness', () => {
    it('keeps independent callers with overlapping IDs searchable', async () => {
        const a = setup([row('shared', 'orchid')]);
        const b = setup([row('shared', 'cobalt')]);
        await a.search.rebuild(); await b.search.rebuild();
        a.search.query.value = 'cobalt'; await a.search.runSearch();
        expect(a.search.results.value).toEqual([]);
        b.search.query.value = 'orchid'; await b.search.runSearch();
        expect(b.search.results.value).toEqual([]);
    });

    it('updates an in-place rename and hides a tombstone without a timestamp change', async () => {
        const { threads, search } = setup([row('one', 'orchid'), row('two', 'orchid')]);
        search.query.value = 'orchid'; await search.runSearch();
        threads.value[0]!.title = 'cobalt';
        threads.value[1]!.deleted = true;
        await vi.waitFor(() => expect(search.results.value).toEqual([]));
        search.query.value = 'cobalt'; await search.runSearch();
        expect(search.results.value.map(row => row.id)).toEqual(['one']);
    });

    it.each(['resolve', 'reject'] as const)('ignores an old search that %ss after clearing the query', async completion => {
        const { search } = setup([row('one', 'orchid'), row('two', 'cobalt')]);
        await search.rebuild();
        let resolve!: (value: { hits: unknown[] }) => void;
        let reject!: (error: Error) => void;
        vi.mocked(searchWithIndex).mockImplementationOnce(() => new Promise((res, rej) => { resolve = res; reject = rej; }));
        search.query.value = 'orchid'; const pending = search.runSearch();
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        search.query.value = ''; await search.runSearch();
        if (completion === 'resolve') resolve({ hits: [{ id: 'one', document: { id: 'one' } }] });
        else reject(new Error('old query failed'));
        await pending;
        expect(search.results.value.map(row => row.id)).toEqual(['one', 'two']);
    });
});
