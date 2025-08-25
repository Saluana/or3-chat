import { ref } from 'vue';
import { listDocuments, type Document } from '~/db/documents';
import { useToast } from '#imports';
import { useHookEffect } from './useHookEffect';

export function useDocumentsList(limit = 200) {
    const docs = ref<Document[]>([]);
    const loading = ref(false);
    const error = ref<unknown>(null);

    async function refresh() {
        loading.value = true;
        error.value = null;
        try {
            docs.value = await listDocuments(limit);
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
