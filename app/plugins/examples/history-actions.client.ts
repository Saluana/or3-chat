import {
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
} from '~/composables/documents/useDocumentHistoryActions';
import {
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
} from '~/composables/threads/useThreadHistoryActions';
import { useToast } from '#imports';
import { db } from '~/db';
import type { Post } from '~/db';
import { nowSec, nextClock, getWriteTxTableNames } from '~/db/util';

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
                let full: Post = document;
                if (!full.content || full.content.length === 0) {
                    const rec = await db.posts.get(document.id);
                    if (rec) full = rec;
                }

                // In a real plugin you'd serialize and offer a download. Here we just show a toast.
                toast.add({
                    title: 'Export (example)',
                    description: `Document ${document.id} has ${full.content.length} characters`,
                    duration: 4000,
                });
            } catch (e: unknown) {
                const message =
                    e instanceof Error ? e.message : 'Unknown error';
                toast.add({
                    title: 'Export failed',
                    description: message,
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
                const threadId = document.id;
                const row = await db.threads.get(threadId);
                if (!row) {
                    toast.add({
                        title: 'Pin failed',
                        description: 'Thread not found',
                        color: 'error',
                    });
                    return;
                }

                await db.transaction(
                    'rw',
                    getWriteTxTableNames(db, 'threads'),
                    async () => {
                    await db.threads.put({
                        ...row,
                        pinned: !row.pinned,
                        updated_at: nowSec(),
                        clock: nextClock(row.clock),
                    });
                });

                toast.add({
                    title: 'Pinned',
                    description: `Thread ${threadId} is now ${
                        !row.pinned ? 'pinned' : 'unpinned'
                    }`,
                    duration: 2500,
                });
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : 'Error';
                toast.add({
                    title: 'Pin failed',
                    description: message,
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
