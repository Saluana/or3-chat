import { ref } from 'vue';
import { listDocuments, type Document } from '@db/documents';
import { useToast } from '#imports';
import { useHookEffect } from '@core/hooks';

export function useDocumentsList(limit = 200) {
    const docs = ref<Document[]>([]);
    // Start in loading state so SSR + client initial VDOM match (avoids hydration text mismatch)
    const loading = ref(true);
    const error = ref<unknown>(null);

    async function refresh() {
        loading.value = true;
        error.value = null;
        try {
            // Fetch full documents then strip heavy fields (content) for sidebar memory efficiency.
            const full = await listDocuments(limit);
            docs.value = full.map((d: any) => ({
                // Keep lightweight/meta fields
                id: d.id,
                title: d.title,
                postType: d.postType,
                created_at: d.created_at,
                updated_at: d.updated_at,
                deleted: d.deleted,
                meta: d.meta,
                // Drop large content string; empty string placeholder keeps type happy
                content: '',
            }));
        } catch (e) {
            error.value = e;
            useToast().add({ color: 'error', title: 'Document: list failed' });
        } finally {
            loading.value = false;
        }
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
