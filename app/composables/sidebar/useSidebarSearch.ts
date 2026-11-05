import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import type { Thread, Project, Post } from '~/db';
import { subscribeActiveWorkspaceDb } from '~/db/client';
import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { createDb, buildIndex, searchWithIndex } from '~/core/search/orama';

interface IndexDoc {
    id: string;
    recordId: string;
    kind: 'thread' | 'project' | 'doc';
    title: string;
    updated_at: number;
}

const isDocPost = (post: Post) => post.postType === 'doc' && isVisibleWorkspaceItem(post);

/** Title search with an instance-owned index and immediate stale-result retirement. */
export function useSidebarSearch(
    threads: Ref<Thread[]>,
    projects: Ref<Project[]>,
    documents: Ref<Post[]>
) {
    const query = ref('');
    const threadResults = ref<Thread[]>([]);
    const projectResults = ref<Project[]>([]);
    const documentResults = ref<Post[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    let dbInstance: unknown = null;
    let indexedSignature = '';
    let revision = 0;
    let queryToken = 0;
    let disposed = false;
    let warnedFallback = false;
    let pendingBuild: Promise<void> | null = null;
    let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
    let queryTimer: ReturnType<typeof setTimeout> | undefined;
    // Owners replace these arrays when the new workspace loads. Until then,
    // neither a pending timer nor a manual search may expose their previous rows.
    const retiredInputs = ref<[Thread[] | null, Project[] | null, Post[] | null]>([null, null, null]);
    watch([threads, projects, documents], ([nextThreads, nextProjects, nextDocuments]) => {
        const retired = retiredInputs.value;
        if (retired[0] && retired[0] !== nextThreads) retired[0] = null;
        if (retired[1] && retired[1] !== nextProjects) retired[1] = null;
        if (retired[2] && retired[2] !== nextDocuments) retired[2] = null;
    }, { flush: 'sync' });
    const visibleThreads = computed(() => threads.value === retiredInputs.value[0] ? [] : threads.value.filter(t => !t.deleted));
    const visibleProjects = computed(() => projects.value === retiredInputs.value[1] ? [] : projects.value.filter(p => !p.deleted));
    const visibleDocuments = computed(() => documents.value === retiredInputs.value[2] ? [] : documents.value.filter(isDocPost));
    const docs = computed<IndexDoc[]>(() => [
        ...visibleThreads.value.map(t => ({ id: `thread:${t.id}`, recordId: t.id, kind: 'thread' as const,
            title: t.title?.trim() || 'Untitled Thread', updated_at: t.updated_at })),
        ...visibleProjects.value.map(p => ({ id: `project:${p.id}`, recordId: p.id, kind: 'project' as const,
            title: p.name?.trim() || 'Untitled Project', updated_at: p.updated_at })),
        ...visibleDocuments.value.map(d => ({ id: `doc:${d.id}`, recordId: d.id, kind: 'doc' as const,
            title: d.title?.trim() || 'Untitled', updated_at: d.updated_at })),
    ]);

    function fallback(raw: string, failed = false) {
        const needle = raw.toLowerCase();
        threadResults.value = visibleThreads.value.filter(t => (t.title?.trim() || 'Untitled Thread').toLowerCase().includes(needle));
        projectResults.value = visibleProjects.value.filter(p => (p.name?.trim() || 'Untitled Project').toLowerCase().includes(needle));
        documentResults.value = visibleDocuments.value.filter(d => (d.title?.trim() || 'Untitled').toLowerCase().includes(needle));
        if (failed && !warnedFallback) {
            warnedFallback = true;
            console.warn('[useSidebarSearch] fallback substring search used');
        }
    }

    async function ensureIndex(): Promise<void> {
        if (import.meta.server || disposed) return;
        if (pendingBuild) return pendingBuild;
        const build = (async () => {
            busy.value = true;
            try {
                while (!disposed) {
                    const snapshot = docs.value;
                    const signature = JSON.stringify(snapshot);
                    if (signature === indexedSignature && dbInstance) { ready.value = true; return; }
                    const version = revision;
                    let next: unknown = null;
                    try {
                        next = await createDb({ id: 'string', recordId: 'string', kind: 'string', title: 'string', updated_at: 'number' });
                        if (next) await buildIndex(next, snapshot);
                    } catch {
                        next = null;
                        if (!disposed && version === revision) fallback(query.value.trim(), true);
                    }
                    if (disposed) return;
                    if (version !== revision) continue;
                    dbInstance = next;
                    indexedSignature = next ? signature : '';
                    ready.value = Boolean(next);
                    return;
                }
            } finally { busy.value = false; }
        })();
        pendingBuild = build;
        try { await build; }
        finally { if (pendingBuild === build) pendingBuild = null; }
    }

    async function runSearch(): Promise<void> {
        if (disposed) return;
        const token = ++queryToken;
        const version = revision;
        const raw = query.value.trim();
        const isCurrent = () => !disposed && token === queryToken && version === revision && raw === query.value.trim();
        if (!raw) { fallback(raw); return; }
        await ensureIndex();
        if (!isCurrent()) return;
        if (!dbInstance) { fallback(raw); return; }
        try {
            const response = await searchWithIndex(dbInstance, raw, 500, { properties: ['title'] });
            if (!isCurrent()) return;
            const hits = new Set(response.hits.map(hit => {
                const row = hit as { document?: IndexDoc; id?: string };
                return row.document?.id ?? row.id;
            }));
            if (!hits.size) { fallback(raw); return; }
            threadResults.value = visibleThreads.value.filter(t => hits.has(`thread:${t.id}`));
            projectResults.value = visibleProjects.value.filter(p => hits.has(`project:${p.id}`));
            documentResults.value = visibleDocuments.value.filter(d => hits.has(`doc:${d.id}`));
        } catch { if (isCurrent()) fallback(raw, true); }
    }

    watch(docs, () => {
        revision += 1;
        queryToken += 1;
        ready.value = false;
        // Retire stale hits synchronously; substring results remain usable while
        // rebuilding, including edits that leave IDs and timestamps unchanged.
        fallback(query.value.trim());
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => { void runSearch(); }, 300);
    }, { flush: 'sync' });
    watch(query, () => {
        queryToken += 1;
        clearTimeout(queryTimer);
        // A cleared query is pass-through immediately. Other queries keep their
        // previous display until debounce, but cannot receive old completions.
        if (!query.value.trim()) { fallback(''); return; }
        queryTimer = setTimeout(() => { void runSearch(); }, 120);
    }, { flush: 'sync' });
    const stopWorkspace = subscribeActiveWorkspaceDb(() => {
        revision += 1;
        queryToken += 1;
        dbInstance = null;
        indexedSignature = '';
        ready.value = false;
        retiredInputs.value = [threads.value, projects.value, documents.value];
        fallback(query.value.trim());
    });
    fallback('');
    onScopeDispose(() => {
        disposed = true;
        queryToken += 1;
        clearTimeout(rebuildTimer);
        clearTimeout(queryTimer);
        stopWorkspace();
    });
    return { query, threadResults, projectResults, documentResults, ready, busy, rebuild: ensureIndex, runSearch };
}

export default useSidebarSearch;
