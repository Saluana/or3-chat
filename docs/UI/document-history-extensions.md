# Document and thread history actions

These registries add actions to the source sidebar's document and thread menus.
They do not add actions to an individual revision checkpoint. Portable packages
use the [SDK](../../public/_documentation/plugins/plugin-sdk.md) rather than
private host imports.

## Source contracts

| Surface | Defining module | Handler payload |
| --- | --- | --- |
| Document row | [useDocumentHistoryActions](../../app/composables/documents/useDocumentHistoryActions.ts) | `{ document: Post }` |
| Thread row | [useThreadHistoryActions](../../app/composables/threads/useThreadHistoryActions.ts) | `{ document: Thread }` |

Both use
[createHistoryActionRegistry](../../app/composables/history/createHistoryActionRegistry.ts).
The thread payload's property is also named `document`; this is the current
contract, confirmed by
[SidebarUnifiedItem](../../app/components/sidebar/SidebarUnifiedItem.vue).

Definitions have a stable namespaced ID, icon, label, optional order,
handler, and optional `pluginId`/`access` policy. Registered actions default
to order 200; core actions have a separate rendering path. Duplicate IDs
replace existing definitions.

## Register and clean up

Create `app/plugins/history-copy-ids.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useToast } from '#imports';
import {
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
} from '~/composables/documents/useDocumentHistoryActions';
import {
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
} from '~/composables/threads/useThreadHistoryActions';

export default defineNuxtPlugin(() => {
    const toast = useToast();
    const documentId = 'example:copy-document-id';
    const threadId = 'example:copy-thread-id';
    registerDocumentHistoryAction({
        id: documentId, icon: 'tabler:copy', label: 'Copy document ID', order: 300,
        async handler({ document }) {
            await navigator.clipboard.writeText(document.id);
            toast.add({ title: 'Document ID copied' });
        },
    });
    registerThreadHistoryAction({
        id: threadId, icon: 'tabler:copy', label: 'Copy thread ID', order: 300,
        async handler({ document: thread }) {
            await navigator.clipboard.writeText(thread.id);
            toast.add({ title: 'Thread ID copied' });
        },
    });
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterDocumentHistoryAction(documentId);
            unregisterThreadHistoryAction(threadId);
        });
    }
});
```

These legacy registration helpers return void. Unregister by your exclusive ID
during HMR or component unmount; do not call `.dispose()` on their return value.
Capture setup-dependent UI helpers during initialization, then use them in
handlers. The sidebar awaits handlers and reports failures.

Verify each action on its matching record type, check copied IDs, and confirm
cleanup after replacement. For revision history, use
[Document history](../../public/_documentation/database/document-revisions.md).
