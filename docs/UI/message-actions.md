# Extensible Chat Message Actions

This guide explains how to add custom action buttons to chat messages (in the same UI area as Copy, Retry, Branch, Edit). It follows the same tone and plugin pattern as the Document History guide.

### Where to import

Helpers are auto-imported by Nuxt, so you can call them from plugins or components without manual imports:

-   `registerMessageAction()`
-   `unregisterMessageAction()`
-   `useMessageActions()`
-   `ChatMessageAction` (type)
-   `listRegisteredMessageActionIds()`

The implementation lives at `app/composables/ui-extensions/messages/useMessageActions.ts` and is registered for auto-import via `app/composables/index.ts`.

### API contract (short)

-   Input: registration of a `ChatMessageAction` object.
-   Output: a button appears in the message action area for matching messages; the UI calls your `handler` with `{ message, threadId }`.
-   Error mode: handlers may throw — the calling component wraps handlers, shows a toast on failure, and logs the error.

Type shape:

```ts
export interface ChatMessageAction {
    id: string; // unique id across plugins
    icon: string; // name passed to <UButton>
    tooltip: string; // tooltip text
    showOn: 'user' | 'assistant' | 'both';
    order?: number; // lower = earlier; default 200
    handler: (ctx: { message: any; threadId?: string }) => void | Promise<void>;
}
```

### Registering an action (plugin pattern)

Create a Nuxt plugin in `app/plugins/` that registers your action at startup:

```ts
// app/plugins/message-share.client.ts
export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'my-plugin:share-link',
        icon: 'pixelarticons:export',
        tooltip: 'Share link',
        showOn: 'assistant',
        order: 300,
        async handler({ message, threadId }) {
            const url = `${location.origin}/thread/${threadId}?anchor=${message.id}`;
            await navigator.clipboard.writeText(url);
            useToast().add({ title: 'Link copied', duration: 2500 });
        },
    });
});
```

Notes:

-   Use `.client.ts` suffix if your action is browser-only, `.server.ts` for server-only, or `.ts` for universal plugins.
-   Plug-ins follow the same pattern as `app/plugins/message-actions.client.ts` and `app/plugins/examples/message-actions-test.client.ts`.
-   Registering an action with a duplicate `id` replaces the existing entry.
-   The registry is stored on `globalThis` so it survives HMR during development.

### Unregistering / cleanup

Most plugins are registered once at startup and don't need explicit teardown. If you do need dynamic removal (for HMR or conditional modules), call:

```ts
unregisterMessageAction('my-plugin:share-link');
```

### Ordering and built-ins

Built-in core actions are hard-coded and intended to appear first. External actions should use `order >= 200` to appear after built-ins unless you intentionally want to appear earlier.

Components sort by `(a.order ?? 200) - (b.order ?? 200)`.

### How the UI reads actions

`ChatMessage.vue` uses the composable under the hood. For advanced scenarios you can use it directly:

```ts
const extraActions = useMessageActions({ role: 'assistant' });
// template: v-for="action in extraActions"
```

When a user clicks an action the component awaits your `handler` inside a try/catch and shows an "Action failed" toast on error.

### Best practices

-   Keep handlers responsive; offload long-running tasks and return promptly.
-   Namespace ids to avoid collisions (e.g. `my-plugin:foo`).
-   Be defensive: validate message shape before operating.
-   Avoid altering core app state without explicit user intent.

### Edge cases & notes

-   Duplicate ids replace previous registrations.
-   Registry persists across HMR; re-registering after HMR will replace the prior entry.
-   Filtering is role-based (`showOn`) and ordering is controlled by `order`.

### Testing

Programmatic checks:

```ts
// After registering
expect(listRegisteredMessageActionIds()).toContain('my-plugin:share-link');

// After unregistering
expect(listRegisteredMessageActionIds()).not.toContain('my-plugin:share-link');
```

Manual verification:

-   Start the app and open a chat thread.
-   Locate a message of the matching role and open the action area.
-   Confirm your button appears with the correct icon and tooltip.
-   Click it and check console logs + toast for expected behavior.

### Troubleshooting

-   Action not visible: ensure the id is unique and the plugin is loaded (check `listRegisteredMessageActionIds()`).
-   Handler throws: the component should display a toast and log the error — inspect console.
-   Missing icon: verify the icon name exists in the project's icon pack.

### Example: test plugin

The repo includes a test plugin at `app/plugins/examples/message-actions-test.client.ts` which follows this pattern and logs detailed info to the console while showing a toast — useful for browser testing.

### Where to go next

-   If you want, I can add a Vitest test that asserts registration/unregistration programmatically.

---

Requirements coverage:

-   Describe API and where to import: Done
-   Show register/unregister examples: Done
-   Show use in components and handler behaviour: Done
-   Explain ordering and HMR behaviour: Done

If you want a test added, tell me and I'll create it.
