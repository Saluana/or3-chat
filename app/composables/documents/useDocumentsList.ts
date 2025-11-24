import { ref } from 'vue';
import { listDocuments, type Document } from '~/db/documents';
import { useToast } from '#imports';
import { useHookEffect } from '../core/useHookEffect';

export function useDocumentsList(limit = 200) {
    const docs = ref<Document[]>([]);
    // Start in loading state so SSR + client initial VDOM match (avoids hydration text mismatch)
    const loading = ref(true);
    const error = ref<unknown>(null);
    let activeRefresh: Promise<void> | null = null;

    async function refresh() {
        // Prevent concurrent refreshes
        if (activeRefresh) {
            return activeRefresh;
        }
        
        loading.value = true;
        error.value = null;
        
        activeRefresh = (async () => {
            try {
                // Fetch full documents then strip heavy fields (content) for sidebar memory efficiency.
                const full = await listDocuments(limit);
                docs.value = full.map((d) => ({
                    // Keep lightweight/meta fields
                    id: d.id,
                    title: d.title,
                    created_at: d.created_at,
                    updated_at: d.updated_at,
                    deleted: d.deleted,
                    // Drop large content string; empty string placeholder keeps type happy
                    content: null,
                }));
            } catch (e) {
                error.value = e;
                useToast().add({ color: 'error', title: 'Document: list failed' });
            } finally {
                loading.value = false;
                activeRefresh = null;
            }
        })();
        
        return activeRefresh;
    }

    // initial load + subscribe to document DB hook events (client only)
    if (process.client) {
        refresh();
        // Auto-refresh on create/update/delete after actions complete
        useHookEffect('db.documents.create:action:after', () => refresh(), {
            kind: 'action',
        });
        useHookEffect('db.documents.update:action:after', () => refresh(), {
            kind: 'action',
        });
        useHookEffect('db.documents.delete:action:*:after', () => refresh(), {
            kind: 'action',
        });
    }

    return { docs, loading, error, refresh };
}
