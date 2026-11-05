import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { listDocuments, type Document } from '~/db/documents';
import { useToast } from '#imports';
import { useHookEffect } from '../core/useHookEffect';

/**
 * Purpose:
 * Provide a lightweight, reactive list of documents for sidebar navigation.
 *
 * Behavior:
 * Loads recent documents, drops heavy content fields, and refreshes on
 * document lifecycle hook events.
 *
 * Constraints:
 * - Client-only auto-refresh behavior gated by process.client
 * - Drops document content to minimize memory use
 *
 * Non-Goals:
 * - Full document hydration
 * - Server-side listing
 *
 * @example
 * ```ts
 * const { docs, loading, refresh } = useDocumentsList(200);
 * await refresh();
 * ```
 */
export function useDocumentsList(limit = 200) {
    const toast = useToast();
    const docs = ref<Document[]>([]);
    // Start in loading state so SSR + client initial VDOM match (avoids hydration text mismatch)
    const loading = ref(true);
    const error = ref<unknown>(null);
    let activeRefresh: Promise<void> | null = null;
    let disposed = false;
    let refreshAgain = false;
    let revision = 0;

    async function refresh() {
        if (disposed) return;
        // Prevent concurrent refreshes
        if (activeRefresh) {
            return activeRefresh;
        }

        loading.value = true;
        error.value = null;
        const mine = ++revision;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const current = () => !disposed && mine === revision && db === getDb() && generation === getWorkspaceGeneration();

        activeRefresh = (async () => {
            try {
                // Fetch full documents then strip heavy fields (content) for sidebar memory efficiency.
                do {
                    refreshAgain = false;
                    const full = await listDocuments(limit);
                    if (!current()) return;
                    docs.value = full.map((d) => ({
                        id: d.id,
                        title: d.title,
                        created_at: d.created_at,
                        updated_at: d.updated_at,
                        deleted: d.deleted,
                        // Sidebar entries do not retain document bodies.
                        content: null,
                    }));
                } while (refreshAgain);
            } catch (e) {
                if (!current()) return;
                error.value = e;
                toast.add({
                    color: 'error',
                    title: 'Document: list failed',
                });
            } finally {
                if (mine === revision) {
                    loading.value = false;
                    activeRefresh = null;
                }
            }
        })();

        return activeRefresh;
    }

    function invalidate() {
        if (activeRefresh) refreshAgain = true;
        return refresh();
    }

    if (getCurrentScope()) {
        const stopWorkspace = subscribeActiveWorkspaceDb(() => {
            revision++;
            activeRefresh = null;
            docs.value = [];
            void refresh();
        });
        onScopeDispose(() => { disposed = true; revision++; stopWorkspace(); });
    }

    // initial load + subscribe to document DB hook events (client only)
    if (process.client) {
        void refresh();
        // Auto-refresh on create/update/delete after actions complete
        useHookEffect('db.documents.create:action:after', invalidate, {
            kind: 'action',
        });
        useHookEffect('db.documents.update:action:after', invalidate, {
            kind: 'action',
        });
        useHookEffect('db.documents.delete:action:*:after', invalidate, {
            kind: 'action',
        });
        useHookEffect('db.posts.upsert:action:after', invalidate, { kind: 'action' });
    }

    return { docs, loading, error, refresh };
}
