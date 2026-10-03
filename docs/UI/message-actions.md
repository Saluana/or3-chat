# Source chat message actions

Use this guide for trusted source code in an editable OR3 checkout. Installable
packages use the [SDK feature recipes](../../public/_documentation/plugins/add-features.md)
and their declared permissions.

The defining module is
[useMessageActions.ts](../../app/composables/chat/useMessageActions.ts).
It exports `ChatMessageAction`, register/unregister helpers, a role-filtered
reactive list, and an ID inspection helper. The handler receives a
`UiChatMessage` and optional `threadId`; import the contract instead of
copying an `any`-based interface.

## Add a copy action

Create `app/plugins/message-copy-id.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useToast } from '#imports';
import { registerMessageAction } from '~/composables/chat/useMessageActions';

export default defineNuxtPlugin(() => {
    const toast = useToast();
    const handle = registerMessageAction({
        id: 'example:copy-message-id',
        icon: 'tabler:copy',
        tooltip: 'Copy message ID',
        showOn: 'both',
        order: 300,
        async handler({ message }) {
            await navigator.clipboard.writeText(message.id);
            toast.add({ title: 'Message ID copied' });
        },
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => { handle.dispose(); });
    }
});
```

The handle removes only this registration; an older instance cannot delete a
newer replacement with the same ID. A component-owned registration must also
dispose on unmount. Use `unregisterMessageAction(id)` only when intentionally
removing the current entry by ID.

## Availability and verification

`showOn` filters by user/assistant role. Optional `pluginId` and `access`
participate in the host access gate. Namespaced IDs avoid collisions; a duplicate
ID replaces its prior definition. The default order is 200, with an ID
tie-breaker for registered actions. Built-ins have their own rendering path,
so an action's order does not imply it can replace a core button.

Open a chat, invoke the action on both roles, and confirm the copied ID matches
the row. Check a second pane and HMR replacement. The consuming
[ChatMessage](../../app/components/chat/ChatMessage.vue) awaits handlers and
reports failure. Clipboard access can fail, so preserve that error handling.
