import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import type { Thread } from '~/db';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
    insertDoc,
    removeDoc,
    updateDoc,
} from '~/core/search/orama';

interface ThreadDoc {
    id: string;
    title: string;
    updated_at: number;
}

// OramaInstance is typed as any from the orama module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OramaInstance = any;

let dbInstance: OramaInstance | null = null;
const indexedState = new Map<string, number>(); // id -> updated_at
let lastQueryToken = 0;

export function useThreadSearch(threads: Ref<Thread[]>) {
    const query = ref('');
    const results = ref<Thread[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const idToThread = ref<Record<string, Thread>>({});

    async function ensureIndex() {
        if (busy.value) return;

        busy.value = true;
        try {
            idToThread.value = Object.fromEntries(
                threads.value.map((t) => [t.id, t])
            );

            if (!dbInstance) {
                dbInstance = await createDb({
                    id: 'string',
                    title: 'string',
                    updated_at: 'number',
                });
                if (!dbInstance) return;

                const docs: ThreadDoc[] = threads.value.map((t) => ({
                    id: t.id,
                    title: t.title || 'Untitled Thread',
                    updated_at: t.updated_at,
                }));
                await buildOramaIndex(dbInstance, docs);

                indexedState.clear();
                docs.forEach((d) => indexedState.set(d.id, d.updated_at));
            } else {
                // Incremental update
                const currentThreads = threads.value;
                const incomingIds = new Set<string>();

                for (const t of currentThreads) {
                    incomingIds.add(t.id);
                    const existingTimestamp = indexedState.get(t.id);
                    const doc: ThreadDoc = {
                        id: t.id,
                        title: t.title || 'Untitled Thread',
                        updated_at: t.updated_at,
                    };

                    if (existingTimestamp === undefined) {
                        await insertDoc(dbInstance, doc);
                        indexedState.set(t.id, t.updated_at);
                    } else if (existingTimestamp !== t.updated_at) {
                        await updateDoc(dbInstance, t.id, doc);
                        indexedState.set(t.id, t.updated_at);
                    }
                }

                // Remove deleted threads
                const toRemove: string[] = [];
                for (const id of indexedState.keys()) {
                    if (!incomingIds.has(id)) {
                        toRemove.push(id);
                    }
                }

                for (const id of toRemove) {
                    await removeDoc(dbInstance, id);
                    indexedState.delete(id);
                }
            }
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        if (!dbInstance) await ensureIndex();
        if (!dbInstance) return;
        const raw = query.value.trim();
        if (!raw) {
            results.value = threads.value;
            return;
        }
        const token = ++lastQueryToken;
        try {
            const r = await searchWithIndex(dbInstance, raw, 200);
            if (token !== lastQueryToken) return;
            const hits = Array.isArray(r.hits) ? r.hits : [];
            const mapped = hits
                .map((h) => {
                    const hit = h as { document?: ThreadDoc } | ThreadDoc;
                    const doc: ThreadDoc =
                        'document' in hit && hit.document
                            ? hit.document
                            : (hit as ThreadDoc);
                    return idToThread.value[doc.id];
                })
                .filter((t: Thread | undefined): t is Thread => !!t);
            if (!mapped.length) {
                const ql = raw.toLowerCase();
                results.value = threads.value.filter((t) =>
                    (t.title || '').toLowerCase().includes(ql)
                );
            } else {
                results.value = mapped;
            }
        } catch (e) {
            const ql = raw.toLowerCase();
            results.value = threads.value.filter((t) =>
                (t.title || '').toLowerCase().includes(ql)
            );

            console.warn('[useThreadSearch] fallback substring search used', e);
        }
    }

    watch(threads, async () => {
        await ensureIndex();
        await runSearch();
    });

    watchDebounced(query, () => void runSearch(), { debounce: 120 });

    // Cleanup on component unmount
    onBeforeUnmount(() => {
        // No manual timer cleanup needed with watchDebounced
    });

    // HMR cleanup: clear timer on module disposal
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            // No manual timer cleanup needed with watchDebounced
        });
    }

    return { query, results, ready, busy, rebuild: ensureIndex, runSearch };
}

export default useThreadSearch;
