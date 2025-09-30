import {
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
} from '~/composables/ui-extensions/documents/useDocumentHistoryActions';
import {
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
} from '~/composables/ui-extensions/threads/useThreadHistoryActions';
import { useToast } from '#imports';
import { db } from '~/db';

/**
 * Example plugin: History Actions
 * - Demonstrates registering document and thread history actions
 * - Uses `useHookEffect` to ensure HMR-safe registration/unregistration
 * - Shows simple handlers that read from `db` and surface a toast
 */
export function setupHistoryActionsExample() {
    const toast = useToast();

    registerDocumentHistoryAction({
        id: 'example:export-doc',
        icon: 'i-carbon-download',
        label: 'Export (Example)',
        order: 250,
        handler: async ({ document }) => {
            try {
                // Ensure we have the full content (document items may be partial in lists)
                let full = document;
                if (!full.content || full.content.length === 0) {
                    const rec = await db.posts.get(document.id);
                    if (rec) full = rec as any;
                }

                // In a real plugin you'd serialize and offer a download. Here we just show a toast.
                toast.add({
                    title: 'Export (example)',
                    description: `Document ${document.id} has ${
                        full?.content?.length ?? 0
                    } characters`,
                    duration: 4000,
                });
            } catch (e: any) {
                toast.add({
                    title: 'Export failed',
                    description: e?.message || 'Unknown error',
                    color: 'error',
                    duration: 4000,
                });
            }
        },
    });

    registerThreadHistoryAction({
        id: 'example:pin-thread',
        icon: 'i-carbon-pin',
        label: 'Pin Thread (Example)',
        order: 210,
        handler: async ({ document }) => {
            try {
                // Toggle a 'pinned' flag on the thread record if present
                const threadId = (document as any).id;
                const row = await db.threads.get(threadId);
                if (!row) {
                    toast.add({
                        title: 'Pin failed',
                        description: 'Thread not found',
                        color: 'error',
                    });
                    return;
                }

                await db.threads.update(threadId, { pinned: !row.pinned });

                toast.add({
                    title: 'Pinned',
                    description: `Thread ${threadId} is now ${
                        !row.pinned ? 'pinned' : 'unpinned'
                    }`,
                    duration: 2500,
                });
            } catch (e: any) {
                toast.add({
                    title: 'Pin failed',
                    description: e?.message || 'Error',
                    color: 'error',
                });
            }
        },
    });

    const cleanup = () => {
        unregisterDocumentHistoryAction('example:export-doc');
        unregisterThreadHistoryAction('example:pin-thread');
    };

    if (import.meta.hot) {
        import.meta.hot.dispose(cleanup);
    }
}

export default defineNuxtPlugin(() => {
    if (import.meta.client) {
        setupHistoryActionsExample();
    }
});
