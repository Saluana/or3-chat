import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Thread, Project, Post } from '~/db';
import { useSidebarSearch } from '../useSidebarSearch';

vi.mock('~/db/client', () => ({
    getWorkspaceGeneration: () => 1,
    subscribeActiveWorkspaceDb: () => () => {},
}));

// Real Orama indexing and search; only workspace lifecycle is isolated.
// Failure cases: an older row changes below a newer row's timestamp, or
// membership changes while the count and maximum timestamp stay constant.
// Keep an existing match so substring fallback cannot hide a stale index.
let wrapper: VueWrapper | undefined;
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
});
