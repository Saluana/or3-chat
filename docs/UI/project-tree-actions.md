# Source project tree actions

Project tree contributions are trusted source integrations. Installable packages
must use the [SDK](../../public/_documentation/plugins/plugin-sdk.md).

The defining module is
[useProjectTreeActions.ts](../../app/composables/projects/useProjectTreeActions.ts).
Import `ProjectTreeAction` and `ProjectTreeHandlerCtx` from there. Register
namespaced IDs, use `label` for visible text, and use `order` for registered
action ordering. Optional `pluginId` and `access` participate in the host gate.

## Current caller payload

The declared context includes `treeRow`, `root`, and `child`. The current
[SidebarProjectTree](../../app/components/sidebar/SidebarProjectTree.vue)
actually passes `{ root }` for project roots and `{ child }` for entries.
Resolve `ctx.treeRow ?? ctx.child ?? ctx.root`; do not assume `treeRow`
is populated by that caller.

`showOn` can name `root`, `chat`, and `doc`. Omit it to appear in all
locations. Although the type also permits `all`, the current template does
not interpret that value as a wildcard.

## Register an action

Create `app/plugins/project-copy-id.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useToast } from '#imports';
import {
    registerProjectTreeAction,
    unregisterProjectTreeAction,
} from '~/composables/projects/useProjectTreeActions';

export default defineNuxtPlugin(() => {
    const toast = useToast();
    const id = 'example:copy-project-row-id';
    registerProjectTreeAction({
        id,
        icon: 'tabler:copy',
        label: 'Copy record ID',
        order: 300,
        async handler(ctx) {
            const row = ctx.treeRow ?? ctx.child ?? ctx.root;
            if (!row) throw new Error('Project row is unavailable');
            await navigator.clipboard.writeText(row.value);
            toast.add({ title: 'Record ID copied' });
        },
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => { unregisterProjectTreeAction(id); });
    }
});
```

This legacy helper returns void; cleanup is by ID, not an owned handle.
Keep the ID exclusive to this registration and clean up before replacement.
Component-owned registrations also need unmount cleanup.

Verify the root, chat-entry, and document-entry popovers and HMR cleanup.
Use the existing workspace resource commands to open records; fabricated
`/chat/:id` or `/docs/:id` routes are not a substitute for pane/tab navigation.
