/**
 * Unified sidebar search across threads, projects, and documents.
 * Modeled after useThreadSearch but merges all three domains into one Orama index
 * for a single fast query. Falls back to substring filtering if Orama fails.
 *
 * Exposed API mirrors existing pattern so integration stays minimal.
 */
import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import type { Thread, Project, Post } from '~/db';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';

/**
 * Interface for documents stored in the search index.
 * Normalizes different entity types (threads, projects, docs) into a common format.
 */
interface IndexDoc {
    /** Unique identifier for the entity */
    id: string;
    /** Type of entity being indexed */
    kind: 'thread' | 'project' | 'doc';
    /** Title used for search matching */
    title: string;
    /** Timestamp for sorting and change detection */
    updated_at: number;
}

/**
 * Type alias for Orama database instance.
 * Using unknown since the exact Orama type isn't needed for this composable.
 */
type OramaInstance = unknown;

/**
 * Debounce delay for rebuilding the search index when data changes (in milliseconds).
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Debounce delay for running searches when the query changes (in milliseconds).
 */
const QUERY_DEBOUNCE_MS = 120;

/**
 * Type guard to check if a post is a document post.
 * Filters out non-doc posts and deleted posts.
 * 
 * @param post - The post to check
 * @returns True if the post is a document and not deleted
 */
function isDocPost(post: Post): boolean {
    const record = post as Record<string, unknown>;
    return record.postType === 'doc' && !record.deleted;
}

/**
 * Converts threads, projects, and documents into normalized IndexDoc format.
 * Handles title fallbacks and ensures consistent data structure for indexing.
 * 
 * @param threads - Array of thread entities
 * @param projects - Array of project entities
 * @param documents - Array of document entities
 * @returns Array of normalized documents ready for indexing
 */
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

/**
 * Builds an Orama search index from the provided entities.
 * Creates the database schema and indexes all documents.
 * 
 * @param threads - Array of thread entities to index
 * @param projects - Array of project entities to index
 * @param documents - Array of document entities to index
 * @returns Orama database instance or null if creation failed
 */
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

/**
 * Computes a signature string to detect when the search index needs rebuilding.
 * Uses entity counts and the latest updated_at timestamp to determine if data has changed.
 * 
 * @param threads - Array of thread entities
 * @param projects - Array of project entities
 * @param documents - Array of document entities
 * @returns Signature string representing the current data state
 */
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

/**
 * Composable for unified sidebar search across threads, projects, and documents.
 * Uses Orama for fast full-text search with substring fallback.
 * Automatically manages index rebuilding and provides debounced search.
 * 
 * @param threads - Reactive reference to threads array
 * @param projects - Reactive reference to projects array
 * @param documents - Reactive reference to documents array
 * @returns Object containing search state and control functions
 */
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
    const cleanupFns: Array<() => void> = [];
    const idMaps = {
        thread: ref<Record<string, Thread>>({}),
        project: ref<Record<string, Project>>({}),
        doc: ref<Record<string, Post>>({}),
    };

    /**
     * Ensures the search index is built and up-to-date.
     * Rebuilds the index only when data has changed based on signature comparison.
     * Updates ID maps for result mapping and sets ready/busy states.
     */
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

    /**
     * Fallback search using substring matching when Orama search fails or returns no results.
     * Provides basic search functionality without requiring the index.
     * Warns once when fallback mode is used.
     * 
     * @param raw - The raw search query string
     */
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

    /**
     * Executes the search using the Orama index.
     * Handles empty queries, result mapping, and automatic fallback to substring search.
     * Uses token-based cancellation to prevent stale results from overriding newer searches.
     */
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
    const stopDataWatch = watch(
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
    cleanupFns.push(stopDataWatch);

    // Debounce query changes
    let queryTimer: ReturnType<typeof setTimeout> | null = null;
    const stopQueryWatch = watch(query, () => {
        if (queryTimer) clearTimeout(queryTimer);
        queryTimer = setTimeout(runSearch, QUERY_DEBOUNCE_MS);
    });
    cleanupFns.push(stopQueryWatch);

    // Initial population (pass-through until first build completes)
    threadResults.value = threads.value;
    projectResults.value = projects.value;
    documentResults.value = documents.value.filter(isDocPost);

    // Cleanup on component unmount
    onBeforeUnmount(() => {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        if (queryTimer) clearTimeout(queryTimer);
        while (cleanupFns.length) {
            const stop = cleanupFns.pop();
            stop?.();
        }
    });

    // HMR cleanup: clear timers on module disposal
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            if (rebuildTimer) clearTimeout(rebuildTimer);
            if (queryTimer) clearTimeout(queryTimer);
            while (cleanupFns.length) {
                const stop = cleanupFns.pop();
                stop?.();
            }
        });
    }

    return {
        /** Reactive search query string */
        query,
        /** Reactive array of matching threads */
        threadResults,
        /** Reactive array of matching projects */
        projectResults,
        /** Reactive array of matching documents */
        documentResults,
        /** Whether the search index is ready for use */
        ready,
        /** Whether the index is currently being built */
        busy,
        /** Function to manually rebuild the search index */
        rebuild: ensureIndex,
        /** Function to manually run a search with current query */
        runSearch,
    };
}

export default useSidebarSearch;
