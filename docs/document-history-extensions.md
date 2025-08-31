## Extending Document History (plugin guide)

This document explains how to add custom actions to the Document History UI. The project exposes a small, extendable API so plugins or site-specific code can register extra buttons that will appear in each document's actions popover.

### Where to import

The helpers are auto-imported by Nuxt, so you can use them directly without imports:

-   `registerDocumentHistoryAction()`
-   `unregisterDocumentHistoryAction()`
-   `useDocumentHistoryActions()`
-   `DocumentHistoryAction` (type)
-   `listRegisteredDocumentHistoryActionIds()`

The implementation lives at `app/composables/ui-extensions/documents/useDocumentHistoryActions.ts` and is registered in `app/composables/index.ts` for auto-import.

### API contract (short)

-   Input: registration of a `DocumentHistoryAction` object.
-   Output: actions appear in the UI popover for each document; the UI calls your `handler` with `{ document: Post }`.
-   Error mode: handler may throw — calling components wrap handlers and will show a toast and log errors.

Type shape:

```ts
export interface DocumentHistoryAction {
    id: string; // unique across plugins
    icon: string; // icon name passed to UButton
    label: string; // visible label
    order?: number; // lower = earlier; default 200
    handler: (ctx: { document: Post }) => void | Promise<void>;
}
```

### Registering an action

Create a Nuxt plugin file in `app/plugins/` to register your action. The plugin will run automatically when the app starts:

```ts
// app/plugins/document-export.client.ts
export default defineNuxtPlugin(() => {
    registerDocumentHistoryAction({
        id: 'my-plugin:export-doc',
        icon: 'material-symbols:download',
        label: 'Export',
        order: 250, // appears after built-in actions (see ordering below)
        async handler({ document }) {
            // run your logic here
            await exportDocumentAsMarkdown(document);
        },
    });
});
```

Notes:

-   Use `.client.ts` suffix if your action only works in the browser
-   Use `.server.ts` suffix if it only works server-side (rare for document actions)
-   Use `.ts` for universal plugins
-   Registering a second action with the same `id` replaces the previous entry
-   The global registry is stored on `globalThis` so it survives HMR during development

### Unregistering / cleanup

Usually you don't need to unregister actions from plugins since they run once at startup. However, if you need dynamic lifecycle management:

```ts
// In a component or composable with lifecycle
unregisterDocumentHistoryAction('my-plugin:export-doc');
```

### Ordering and built-ins

Built-in core actions are hard-coded in the component and are intended to appear first. External actions should use `order >= 200` to appear after built-ins unless you purposely want to override/insert earlier (use a lower number).

The accessor used in components sorts by `(a.order ?? 200) - (b.order ?? 200)`.

### How the UI reads actions

In components you can obtain the reactive list via:

```ts
const extraActions = useDocumentHistoryActions();
// in template: v-for="action in extraActions"
```

The component that invokes action handlers typically does so inside a try/catch and shows a toast on error. Handlers are awaited so they can be asynchronous.

Example of how a component invokes a handler (conceptual):

```ts
async function runExtraAction(action: DocumentHistoryAction, document: Post) {
    try {
        await action.handler({ document });
    } catch (e) {
        // component shows a toast and logs the error
    }
}
```

### Best practices

-   Keep handlers quick; open long-running jobs in the background and return promptly.
-   Use unique ids namespaced by your plugin (e.g. `my-plugin:do-thing`).
-   Be defensive: check document shape and required fields before operating.
-   Avoid side-effects that modify core data without explicit user confirmation.

### Edge cases & notes

-   Duplicate ids replace previous registrations.
-   Registry persists across HMR — a second registration after HMR will replace the existing entry.
-   The reactive wrapper is a simple array snapshot generated from a Map; mutation order is controlled by the `order` property.

### Testing

Programmatic checks:

```ts
// After registering
expect(listRegisteredDocumentHistoryActionIds()).toContain(
    'my-plugin:export-doc'
);

// After unregistering
expect(listRegisteredDocumentHistoryActionIds()).not.toContain(
    'my-plugin:export-doc'
);
```

Manual verification:

-   Open a document list or the Document History UI.
-   Open the actions popover for a document and confirm your action appears with the correct label and icon.
-   Click the action and validate the effect.

### Troubleshooting

-   Action not visible: ensure your action id is unique and you registered it before the component mounts (or re-register after HMR). Check `listRegisteredDocumentHistoryActionIds()`.
-   Handler throws: component should display a toast; check console for logs.
-   Icon missing: verify the icon name is supported by the project's icon set.

### Example: full plugin pattern

```ts
// app/plugins/document-external-link.client.ts
export default defineNuxtPlugin(() => {
    registerDocumentHistoryAction({
        id: 'my-plugin:open-external',
        icon: 'tabler:external-link',
        label: 'Open externally',
        order: 300,
        handler: ({ document }) => {
            window.open(`/export/${document.id}`, '_blank');
        },
    });
});
```

This follows the same pattern as the existing `message-actions.client.ts` plugin.

### Where to go next

-   See `app/plugins/message-actions.client.ts` for a similar pattern that registers message actions
-   If you want, I can add a sample document history plugin under `plugins/` that registers a sample action and a Vitest test

---

Requirements coverage:

-   Describe API and where to import: Done
-   Show register/unregister examples: Done
-   Show use in components and handler behaviour: Done
-   Explain ordering and HMR behaviour: Done

If you'd like an example plugin + test, tell me and I'll add it.
