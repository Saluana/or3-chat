import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import type { Thread } from '~/db';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';

interface ThreadDoc {
    id: string;
    title: string;
    updated_at: number;
}

// OramaInstance is typed as any from the orama module
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-explicit-any
type OramaInstance = any;
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
let dbInstance: OramaInstance | null = null;
let lastQueryToken = 0;

async function buildIndex(threads: Thread[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    dbInstance = await createDb({
        id: 'string',
        title: 'string',
        updated_at: 'number',
    });
    if (!dbInstance) return null;
    const docs: ThreadDoc[] = threads.map((t) => ({
        id: t.id,
        title: t.title || 'Untitled Thread',
        updated_at: t.updated_at,
    }));
    await buildOramaIndex(dbInstance, docs);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return dbInstance;
}

export function useThreadSearch(threads: Ref<Thread[]>) {
    const query = ref('');
    const results = ref<Thread[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedCount = ref(0);
    const idToThread = ref<Record<string, Thread>>({});

    async function ensureIndex() {
        if (busy.value) return;
        if (threads.value.length === lastIndexedCount.value && dbInstance)
            return;
        busy.value = true;
        try {
            idToThread.value = Object.fromEntries(
                threads.value.map((t) => [t.id, t])
            );
            await buildIndex(threads.value);
            lastIndexedCount.value = threads.value.length;
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
            const hits = Array.isArray(r?.hits) ? r.hits : [];
            const mapped = hits
                .map((h) => {
                    const hit = h as { document?: ThreadDoc } | ThreadDoc;
                    const doc: ThreadDoc = 'document' in hit && hit.document ? hit.document : hit as ThreadDoc;
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

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    watch(query, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void runSearch(), 120);
    });

    // Cleanup on component unmount
    onBeforeUnmount(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
    });

    // HMR cleanup: clear timer on module disposal
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
        });
    }

    return { query, results, ready, busy, rebuild: ensureIndex, runSearch };
}

export default useThreadSearch;
