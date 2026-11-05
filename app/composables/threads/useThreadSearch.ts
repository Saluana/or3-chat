import { ref, type Ref } from 'vue';
import type { Post, Project, Thread } from '~/db';
import { useSidebarSearch } from '~/composables/sidebar/useSidebarSearch';

/** Reuse the workspace-scoped title search lifecycle for thread-only callers. */
export function useThreadSearch(threads: Ref<Thread[]>) {
    const { query, threadResults, ready, busy, rebuild, runSearch } = useSidebarSearch(
        threads, ref<Project[]>([]), ref<Post[]>([])
    );
    return { query, results: threadResults, ready, busy, rebuild, runSearch };
}

export default useThreadSearch;
