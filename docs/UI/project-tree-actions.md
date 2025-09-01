````markdown
# Extensible Project Tree Actions

This guide explains how to add custom action buttons to the project tree (the popover shown for project roots and entries in the sidebar). It follows the same tone and plugin pattern used for the Message Actions guide.

### Where to import

Helpers and types are auto-imported by Nuxt, so you can call them from plugins or components without manual imports:

-   `registerProjectTreeAction()`
-   `unregisterProjectTreeAction()`
-   `useProjectTreeActions()`
-   `ProjectTreeAction` (type)
-   `ProjectTreeHandlerCtx` (type)
-   `listRegisteredProjectTreeActionIds()`

The implementation lives at `app/composables/ui-extensions/projects/useProjectTreeActions.ts` and is registered for auto-import via `app/composables/index.ts`.

### API contract (short)

-   Input: registration of a `ProjectTreeAction` object.
-   Output: a button appears in the project-root or entry popover for matching rows; the UI calls your `handler` with a `ProjectTreeHandlerCtx` describing the clicked row.
-   Error mode: handlers may throw — the consuming component wraps handlers, shows a toast on failure, and logs the error.

Type shape:

```ts
export interface ProjectTreeAction {
    id: string; // unique id across plugins
    icon: string; // name passed to UButton / UIcon
    label: string; // visible label in the popover
    order?: number; // lower = earlier; default 200
    showOn?: ('root' | 'all' | 'chat' | 'doc')[]; // optional filter of where to show
    handler: (ctx: ProjectTreeHandlerCtx) => void | Promise<void>;
}

export interface ProjectTreeHandlerCtx {
    // The tree row this action was invoked for (root or child)
    treeRow: ProjectTreeRow;
    // Backwards-compatible aliases sometimes present in callers
    child?: ProjectTreeChild;
    root?: ProjectTreeRoot;
}
```

`ProjectTreeRow` may be either the project root shape or a child entry shape; prefer `treeRow` in handlers.

### Registering an action (plugin pattern)

Create a Nuxt plugin in `app/plugins/` that registers your action at startup. Use `.client.ts` for browser-only actions.

Example: register a root-targeted action that inspects a project

```ts
// app/plugins/project-tree-inspect.client.ts
export default defineNuxtPlugin(() => {
    registerProjectTreeAction({
        id: 'my-plugin:inspect-project',
        icon: 'i-lucide-eye',
        label: 'Inspect Project',
        order: 300,
        showOn: ['root'],
        async handler(ctx: ProjectTreeHandlerCtx) {
            // ctx.treeRow will be the project root row
            console.group('[project-tree] inspect');
            console.log(ctx);
            console.groupEnd();
            useToast().add({ title: 'Project inspected', duration: 2000 });
        },
    });
});
```

Example: register an entry-targeted action (chat/doc entries)

```ts
// app/plugins/project-tree-open.client.ts
export default defineNuxtPlugin(() => {
    registerProjectTreeAction({
        id: 'my-plugin:open-entry',
        icon: 'pixelarticons:open',
        label: 'Open entry',
        showOn: ['chat', 'doc'],
        async handler(ctx) {
            const row = ctx.treeRow;
            if (row && 'parentId' in row) {
                // child entry
                if (row.kind === 'chat') {
                    // navigate to chat
                    navigateTo(`/chat/${row.value}`);
                } else {
                    navigateTo(`/docs/${row.value}`);
                }
            }
        },
    });
});
```

Notes:

-   Use `.client.ts` if your action is browser-only, `.server.ts` for server-only, or `.ts` for universal plugins.
-   Registering an action with a duplicate `id` replaces the existing entry.
-   The registry is kept on `globalThis` to survive HMR during development.

### Unregistering / cleanup

Most plugins register once at startup and don't need explicit teardown. If you need dynamic removal (for HMR or conditional modules), call:

```ts
unregisterProjectTreeAction('my-plugin:inspect-project');
```

### Ordering and built-ins

Built-in core actions are hard-coded in the component so they always appear; external actions should use `order >= 200` to appear after built-ins unless you intentionally want to appear earlier.

Components sort by `(a.order ?? 200) - (b.order ?? 200)`.

### How the UI reads actions

`SidebarProjectTree.vue` uses the composable under the hood. Key behaviors:

-   It reads `useProjectTreeActions()` as `extraActions` and renders them inside the entry/popover area.
-   For root-level popover buttons the template checks `!action.showOn || action.showOn.includes('root')`.
-   For child entries the template checks `!action.showOn || action.showOn.includes(item.kind as any)`.
-   When the user clicks an action the component calls your `handler` and wraps it in try/catch. On error it shows a toast "Action failed" and logs the error.

The component also provides a `runExtraAction` helper that awaits the handler and shows a toast on failure.

### Best practices

-   Keep handlers responsive; offload long-running tasks and return promptly.
-   Namespace ids to avoid collisions (e.g. `my-plugin:foo`).
-   Be defensive: validate `ctx.treeRow` shape before operating.
-   Use `order` to control placement relative to built-ins.

### Edge cases & notes

-   Duplicate ids replace previous registrations.
-   Registry persists across HMR; re-registering after HMR will replace the prior entry.
-   `showOn` is an array of `('root'|'all'|'chat'|'doc')`. If omitted the action is candidate for all locations (but templates still filter by logical checks).

### Testing

Programmatic checks:

```ts
// After registering
expect(listRegisteredProjectTreeActionIds()).toContain(
    'my-plugin:inspect-project'
);

// After unregistering
expect(listRegisteredProjectTreeActionIds()).not.toContain(
    'my-plugin:inspect-project'
);
```

Manual verification:

-   Start the app and open the Projects sidebar.
-   Open the project root or entry popover.
-   Confirm your button appears with the correct icon and label.
-   Click it and check console logs + toast for expected behavior.

### Troubleshooting

-   Action not visible: ensure the id is unique and the plugin is loaded (check `listRegisteredProjectTreeActionIds()`).
-   Handler throws: the component should display a toast and log the error — inspect console.
-   Missing icon: verify the icon name exists in the project's icon pack.

### Example: test plugin

See `app/plugins/example-plugin.client.ts` for a small test plugin pattern — the same approach applies for project tree actions. Example adapted:

```ts
export default defineNuxtPlugin(() => {
    try {
        registerProjectTreeAction({
            id: 'test:inspect-thread',
            icon: 'i-lucide-eye',
            label: 'Inspect Thread',
            order: 300,
            showOn: ['root', 'chat'],
            async handler(ctx: ProjectTreeHandlerCtx) {
                console.log(ctx);
                useToast().add({ title: 'Inspected', duration: 2000 });
            },
        });
    } catch (e) {
        console.error('[project-tree-test] registration error', e);
    }
});
```

### Where to go next

-   If you want, I can add a Vitest unit test that asserts registration/unregistration programmatically and a minimal example plugin under `app/plugins/examples/` for easy manual testing.

---

Requirements coverage:

-   Describe API and where to import: Done
-   Show register/unregister examples: Done
-   Show use in components and handler behaviour: Done (notes about `SidebarProjectTree.vue` checks and `runExtraAction` behavior)
-   Explain ordering and HMR behaviour: Done

If you'd like tests or an example plugin file created, tell me and I'll add them.
````
