import { ref, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import type { TaskListMetaV1 } from '../types';
import {
    buildTaskListSearchDocs,
    computeTaskListSearchSignature,
    createTaskListSearchIndex,
    searchTaskListIndex,
    substringTaskListSearch,
    type TaskListSearchIndex,
    type TaskListSearchSource,
} from '../utils/search';

interface TaskListLike extends TaskListSearchSource {
    id: string;
}

const SEARCH_LIMIT = 200;

export function useTaskListSearch(
    lists: Ref<TaskListLike[]>,
    readMeta: (meta: unknown) => TaskListMetaV1
) {
    const query = ref('');
    const results = ref<TaskListLike[]>([]);
    const ready = ref(false);
    const busy = ref(false);

    const idToList = ref<Record<string, TaskListLike>>({});
    const docs = ref<ReturnType<typeof buildTaskListSearchDocs>>([]);
    const lastIndexedSignature = ref('');
    let index: TaskListSearchIndex | null = null;
    let warnedFallback = false;
    let lastQueryToken = 0;

    async function ensureIndex() {
        if (import.meta.server || busy.value) return;
        const signature = computeTaskListSearchSignature(lists.value);
        if (signature === lastIndexedSignature.value && index) return;
        busy.value = true;
        try {
            idToList.value = Object.fromEntries(
                lists.value.map((list) => [list.id, list])
            );
            docs.value = buildTaskListSearchDocs(lists.value, readMeta);
            index = await createTaskListSearchIndex(docs.value);
            lastIndexedSignature.value = signature;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        const raw = query.value.trim();
        if (!raw) {
            results.value = lists.value;
            return;
        }

        const token = ++lastQueryToken;
        await ensureIndex();

        if (token !== lastQueryToken) return;

        if (!index) {
            const ids = substringTaskListSearch(docs.value, raw, SEARCH_LIMIT);
            results.value = ids
                .map((id) => idToList.value[id])
                .filter((list): list is TaskListLike => Boolean(list));
            return;
        }

        const searchResult = await searchTaskListIndex(index, raw, SEARCH_LIMIT);
        if (token !== lastQueryToken) return;

        if (searchResult.usedFallback && !warnedFallback) {
            warnedFallback = true;
            console.warn('[tasks.search] fallback substring search used');
        }

        results.value = searchResult.ids
            .map((id) => idToList.value[id])
            .filter((list): list is TaskListLike => Boolean(list));
    }

    watch(
        lists,
        async () => {
            await ensureIndex();
            await runSearch();
        },
        { immediate: true }
    );

    watchDebounced(query, () => void runSearch(), { debounce: 120 });

    return {
        query,
        results,
        ready,
        busy,
        rebuild: ensureIndex,
        runSearch,
    };
}
