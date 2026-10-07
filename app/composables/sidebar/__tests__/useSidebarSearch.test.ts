import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Thread, Project, Post } from '~/db';
import { buildIndex, createDb } from '~/core/search/orama';
import { useSidebarSearch } from '../useSidebarSearch';

vi.mock('~/db/client', () => ({
    getWorkspaceGeneration: () => 1,
    subscribeActiveWorkspaceDb: () => () => {},
}));

// Real Orama indexing and search; these wrappers only count the real calls
// (and, in one case, hold a real build open).
vi.mock('~/core/search/orama', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/core/search/orama')>();
    return { ...actual, createDb: vi.fn(actual.createDb), buildIndex: vi.fn(actual.buildIndex) };
});

// Only workspace lifecycle is isolated.
// Failure cases: an older row changes below a newer row's timestamp,
// membership changes while the count and maximum timestamp stay constant,
// a change lands while an earlier build is still running (its debounced
// trigger is skipped as busy), and unchanged data must not rebuild.
// Keep an existing match so substring fallback cannot hide a stale index.
let wrapper: VueWrapper | undefined;
beforeEach(() => { vi.mocked(createDb).mockClear(); vi.mocked(buildIndex).mockClear(); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });
function setup() {
    const threads = ref<Thread[]>([
        { id: 'newer', title: 'orchid reference', updated_at: 100 } as Thread,
        { id: 'older', title: 'unrelated subject', updated_at: 1 } as Thread,
    ]);
    let search!: ReturnType<typeof useSidebarSearch>;
    wrapper = mount(defineComponent({
        setup() {
            search = useSidebarSearch(threads, ref<Project[]>([]), ref<Post[]>([]));
            return () => h('div');
        },
    }));
    return { threads, search };
}

describe('sidebar search index invalidation', () => {
    it('indexes title changes even when another record has a newer timestamp', async () => {
        const { threads, search } = setup();
        await search.rebuild();
        threads.value = [threads.value[0]!, { ...threads.value[1]!, title: 'orchid notes', updated_at: 2 }];
        await search.rebuild();
        search.query.value = 'orchid';
        await search.runSearch();
        expect(search.threadResults.value.map(row => row.id)).toEqual(['newer', 'older']);
    });

    it('indexes replacement rows without requiring a changed count or newest timestamp', async () => {
        const { threads, search } = setup();
        await search.rebuild();
        threads.value = [threads.value[0]!, { id: 'replacement', title: 'orchid plans', updated_at: 2 } as Thread];
        await search.rebuild();
        search.query.value = 'orchid';
        await search.runSearch();
        expect(search.threadResults.value.map(row => row.id)).toEqual(['newer', 'replacement']);
    });

    it('does not rebuild when the indexed fields are unchanged', async () => {
        const { threads, search } = setup();
        await search.rebuild();
        threads.value = threads.value.map(row => ({ ...row }));
        await search.rebuild();
        expect(createDb).toHaveBeenCalledTimes(1);
    });

    it('indexes a change that lands while an earlier build outlasts the rebuild debounce', async () => {
        const real = await vi.importActual<typeof import('~/core/search/orama')>('~/core/search/orama');
        const { threads, search } = setup();
        // Hold the first build open past the 300 ms debounce so the rebuild the
        // change triggers finds the index busy and is skipped.
        vi.mocked(buildIndex).mockImplementationOnce(async (db, docs) => {
            await new Promise(resolve => setTimeout(resolve, 350));
            return real.buildIndex(db, docs);
        });
        const building = search.rebuild();
        threads.value = [threads.value[0]!, { ...threads.value[1]!, title: 'orchid notes' }];
        await building;
        search.query.value = 'orchid';
        await vi.waitFor(async () => {
            await search.runSearch();
            expect(search.threadResults.value.map(row => row.id)).toEqual(['newer', 'older']);
        }, { timeout: 3000 });
    });
});
