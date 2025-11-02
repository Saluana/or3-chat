// Unified sidebar search across threads, projects, and documents.
// Modeled after useThreadSearch but merges all three domains into one Orama index
// for a single fast query. Falls back to substring filtering if Orama fails.
//
// Exposed API mirrors existing pattern so integration stays minimal.
import { ref, watch, type Ref } from 'vue';
import type { Thread, Project, Post } from '~/db';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';

interface IndexDoc {
    id: string;
    kind: 'thread' | 'project' | 'doc';
    title: string;
    updated_at: number;
}

type OramaInstance = unknown;

// Debounce constants
const SEARCH_DEBOUNCE_MS = 300;
const QUERY_DEBOUNCE_MS = 120;

/**
 * Type guard for doc posts
 */
function isDocPost(post: Post): boolean {
    const record = post as Record<string, unknown>;
    return record.postType === 'doc' && !record.deleted;
}

function toDocs(
    threads: Thread[],
    projects: Project[],
    documents: Post[]
): IndexDoc[] {
    const threadDocs: IndexDoc[] = threads.map((t) => ({
        id: t.id,
        kind: 'thread' as const,
        title: (t.title || 'Untitled Thread').trim() || 'Untitled Thread',
        updated_at: t.updated_at,
    }));
    const projectDocs: IndexDoc[] = projects.map((p) => ({
        id: p.id,
        kind: 'project' as const,
        title: (p.name || 'Untitled Project').trim() || 'Untitled Project',
        updated_at: p.updated_at,
    }));
    const docDocs: IndexDoc[] = documents.filter(isDocPost).map((d) => {
        const record = d as Record<string, unknown>;
        return {
            id: d.id,
            kind: 'doc' as const,
            title: (record.title as string | undefined) || 'Untitled',
            updated_at: (record.updated_at as number) || 0,
        };
    });
    return [...threadDocs, ...projectDocs, ...docDocs];
}

async function buildIndex(
    threads: Thread[],
    projects: Project[],
    documents: Post[]
) {
    const instance = await createDb({
        id: 'string',
        kind: 'string',
        title: 'string',
        updated_at: 'number',
    });
    if (!instance) return null;
    const docs = toDocs(threads, projects, documents);
    if (docs.length) await buildOramaIndex(instance, docs);
    return instance;
}

// Signature helper to know when to rebuild (counts + latest updated_at)
function computeSignature(
    threads: Thread[],
    projects: Project[],
    documents: Post[]
) {
    let latest = 0;
    for (const t of threads) if (t.updated_at > latest) latest = t.updated_at;
    for (const p of projects) if (p.updated_at > latest) latest = p.updated_at;
    for (const d of documents) {
        const record = d as Record<string, unknown>;
        const updatedAt = (record.updated_at as number) || 0;
        if (updatedAt > latest) latest = updatedAt;
    }
    return `${threads.length}:${projects.length}:${documents.length}:${latest}`;
}

export function useSidebarSearch(
    threads: Ref<Thread[]>,
    projects: Ref<Project[]>,
    documents: Ref<Post[]>
) {
    let dbInstance: OramaInstance | null = null;
    let lastQueryToken = 0;
    let warnedFallback = false;
    const query = ref('');
    const threadResults = ref<Thread[]>([]);
    const projectResults = ref<Project[]>([]);
    const documentResults = ref<Post[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedSignature = ref('');
    const idMaps = {
        thread: ref<Record<string, Thread>>({}),
        project: ref<Record<string, Project>>({}),
        doc: ref<Record<string, Post>>({}),
    };

    async function ensureIndex() {
        if (busy.value) return;
        const sig = computeSignature(
            threads.value,
            projects.value,
            documents.value
        );
        if (sig === lastIndexedSignature.value && dbInstance) return;
        busy.value = true;
        try {
            idMaps.thread.value = Object.fromEntries(
                threads.value.map((t) => [t.id, t])
            );
            idMaps.project.value = Object.fromEntries(
                projects.value.map((p) => [p.id, p])
            );
            idMaps.doc.value = Object.fromEntries(
                documents.value.filter(isDocPost).map((d) => [d.id, d])
            );
            dbInstance = await buildIndex(
                threads.value,
                projects.value,
                documents.value
            );
            lastIndexedSignature.value = sig;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    function substringFallback(raw: string) {
        const ql = raw.toLowerCase();
        const threadHits = threads.value.filter((t) =>
            (t.title || '').toLowerCase().includes(ql)
        );
        const projectHits = projects.value.filter((p) =>
            (p.name || '').toLowerCase().includes(ql)
        );
        const docHits = documents.value.filter((d) => {
            if (!isDocPost(d)) return false;
            const record = d as Record<string, unknown>;
            const title = (record.title as string | undefined) || '';
            return title.toLowerCase().includes(ql);
        });
        threadResults.value = threadHits;
        projectResults.value = projectHits;
        documentResults.value = docHits;
        if (!warnedFallback) {
            // eslint-disable-next-line no-console
            console.warn('[useSidebarSearch] fallback substring search used');
            warnedFallback = true;
        }
    }

    async function runSearch() {
        if (!dbInstance) await ensureIndex();
        if (!dbInstance) return;
        const raw = query.value.trim();
        if (!raw) {
            threadResults.value = threads.value;
            projectResults.value = projects.value;
            documentResults.value = documents.value.filter(isDocPost);
            return;
        }
        const token = ++lastQueryToken;
        try {
            const res = await searchWithIndex(dbInstance, raw, 500);
            if (token !== lastQueryToken) return; // stale
            const hits = Array.isArray(res?.hits) ? res.hits : [];
            const byKind: Record<'thread' | 'project' | 'doc', Set<string>> = {
                thread: new Set(),
                project: new Set(),
                doc: new Set(),
            };
            for (const h of hits) {
                const doc =
                    (h as { document?: IndexDoc }).document || (h as IndexDoc);
                if (
                    doc?.kind &&
                    doc?.id &&
                    byKind[doc.kind as keyof typeof byKind]
                ) {
                    byKind[doc.kind as keyof typeof byKind].add(doc.id);
                }
            }
            // Apply sets
            if (
                !byKind.thread.size &&
                !byKind.project.size &&
                !byKind.doc.size
            ) {
                // Nothing matched -> fallback substring to provide any partials
                substringFallback(raw);
                return;
            }
            threadResults.value = threads.value.filter((t) =>
                byKind.thread.has(t.id)
            );
            projectResults.value = projects.value.filter((p) =>
                byKind.project.has(p.id)
            );
            documentResults.value = documents.value.filter((d) =>
                byKind.doc.has(d.id)
            );
            // If a project contains matching threads/docs but project name itself didn't match, UI can choose to retain by containment; we leave that logic to integration to keep composable lean.
        } catch (e) {
            substringFallback(raw);
        }
    }

    // Rebuild index & rerun search on data change with debounce
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    watch(
        [threads, projects, documents],
        () => {
            if (rebuildTimer) clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(async () => {
                await ensureIndex();
                await runSearch();
            }, SEARCH_DEBOUNCE_MS);
        },
        { deep: false }
    );

    // Debounce query changes
    let queryTimer: ReturnType<typeof setTimeout> | null = null;
    watch(query, () => {
        if (queryTimer) clearTimeout(queryTimer);
        queryTimer = setTimeout(runSearch, QUERY_DEBOUNCE_MS);
    });

    // Initial population (pass-through until first build completes)
    threadResults.value = threads.value;
    projectResults.value = projects.value;
    documentResults.value = documents.value.filter(isDocPost);

    return {
        query,
        threadResults,
        projectResults,
        documentResults,
        ready,
        busy,
        rebuild: ensureIndex,
        runSearch,
    };
}

export default useSidebarSearch;
