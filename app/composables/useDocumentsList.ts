import { ref } from 'vue';
import { listDocuments, type Document } from '~/db/documents';
import { useToast } from '#imports';

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

    // initial load (client only)
    if (process.client) {
        refresh();
    }

    return { docs, loading, error, refresh };
}
