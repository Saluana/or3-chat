import { ref, reactive } from 'vue';
import {
    createDocument,
    updateDocument,
    getDocument,
    type Document,
} from '~/db/documents';
import { useToast } from '#imports';

interface DocState {
    record: Document | null;
    status: 'idle' | 'saving' | 'saved' | 'error' | 'loading';
    lastError?: any;
    pendingTitle?: string; // staged changes
    pendingContent?: any; // TipTap JSON
    timer?: any;
}

const documentsMap = reactive(new Map<string, DocState>());
const loadingIds = ref(new Set<string>());

function ensure(id: string): DocState {
    let st = documentsMap.get(id);
    if (!st) {
        st = { record: null, status: 'loading' } as DocState;
        documentsMap.set(id, st);
    }
    return st;
}

function scheduleSave(id: string, delay = 750) {
    const st = documentsMap.get(id);
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => flush(id), delay);
}

export async function flush(id: string) {
    const st = documentsMap.get(id);
    if (!st || !st.record) return;
    if (!st.pendingTitle && !st.pendingContent) return; // nothing to persist
    const patch: any = {};
    if (st.pendingTitle !== undefined) patch.title = st.pendingTitle;
    if (st.pendingContent !== undefined) patch.content = st.pendingContent;
    st.status = 'saving';
    try {
        const updated = await updateDocument(id, patch);
        if (updated) {
            st.record = updated;
            st.status = 'saved';
        } else {
            st.status = 'error';
        }
    } catch (e) {
        st.status = 'error';
        st.lastError = e;
        useToast().add({ color: 'error', title: 'Document: save failed' });
    } finally {
        st.pendingTitle = undefined;
        st.pendingContent = undefined;
    }
}

export async function loadDocument(id: string) {
    const st = ensure(id);
    st.status = 'loading';
    try {
        const rec = await getDocument(id);
        st.record = rec || null;
        st.status = rec ? 'idle' : 'error';
        if (!rec) {
            useToast().add({ color: 'error', title: 'Document: not found' });
        }
    } catch (e) {
        st.status = 'error';
        st.lastError = e;
        useToast().add({ color: 'error', title: 'Document: load failed' });
    }
    return st.record;
}

export async function newDocument(initial?: { title?: string; content?: any }) {
    try {
        const rec = await createDocument(initial);
        const st = ensure(rec.id);
        st.record = rec;
        st.status = 'idle';
        return rec;
    } catch (e) {
        useToast().add({ color: 'error', title: 'Document: create failed' });
        throw e;
    }
}

export function setDocumentTitle(id: string, title: string) {
    const st = ensure(id);
    if (st.record) {
        st.pendingTitle = title;
        scheduleSave(id);
    }
}

export function setDocumentContent(id: string, content: any) {
    const st = ensure(id);
    if (st.record) {
        st.pendingContent = content;
        scheduleSave(id);
    }
}

export function useDocumentState(id: string) {
    return documentsMap.get(id) || ensure(id);
}

export function useAllDocumentsState() {
    return documentsMap;
}

// Release a document's in-memory state (after ensuring pending changes flushed).
// This lets GC reclaim large TipTap JSON payloads when switching away.
export async function releaseDocument(
    id: string,
    opts: { flush?: boolean; deleteEntry?: boolean } = {}
) {
    // Rename to avoid shadowing the exported flush(id) function above.
    const { flush: shouldFlush = true, deleteEntry = true } = opts;
    const st = documentsMap.get(id);
    if (!st) return;
    if (st.timer) {
        clearTimeout(st.timer);
        st.timer = undefined;
    }
    if (shouldFlush) {
        try {
            await flush(id);
        } catch {}
    }
    // Null record to drop heavy content reference; then optionally drop entry entirely.
    if (st.record) {
        try {
            // Remove large nested content tree reference if present.
            if ((st.record as any).content)
                (st.record as any).content = undefined;
        } catch {}
        st.record = null;
    }
    st.pendingTitle = undefined;
    st.pendingContent = undefined;
    if (deleteEntry) {
        documentsMap.delete(id);
    }
}
