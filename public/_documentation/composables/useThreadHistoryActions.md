# useThreadHistoryActions

Registry for adding custom actions to the thread history sidebar dropdown. Mirrors the document history registry but targets threads, letting plugins inject export, share, or workflow buttons.

---

## What does it do?

`useThreadHistoryActions` exposes:

-   `registerThreadHistoryAction()` / `unregisterThreadHistoryAction()` to manage action lifecycle.
-   `useThreadHistoryActions()` to read a sorted, reactive list of actions for rendering.
-   `listRegisteredThreadHistoryActionIds()` for debugging or collision checks.

Actions are stored globally on `globalThis`, so they persist across HMR and shared imports.

---

## Basic Example

```ts
import {
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
    useThreadHistoryActions,
} from '~/composables/threads/useThreadHistoryActions';

registerThreadHistoryAction({
    id: 'custom:export-thread',
    icon: 'i-ph-cloud-arrow-down',
    label: 'Export Thread',
    order: 210,
    async handler({ document }) {
        await exportThread(document.id);
    },
});

const actions = useThreadHistoryActions();

onScopeDispose(() => {
    unregisterThreadHistoryAction('custom:export-thread');
});
```

---

## How to use it

### 1. Register actions when your plugin loads

-   Namespace IDs (`my-plugin:action`) to avoid collisions.
-   Provide `icon`, `label`, optional `order`, and a `handler` receiving `{ document: Thread }`.

### 2. Consume the computed list

-   Components like `SidebarThreadHistory.vue` call `useThreadHistoryActions()` to obtain sorted actions.
-   The returned array is already sorted by `order` (default 200) so you can render directly.

### 3. Cleanup for HMR

-   Call `unregisterThreadHistoryAction()` (or wrap registration in `useHookEffect`) to keep the registry tidy during hot reloads.

### 4. Handle async operations

-   `handler` can be async; manage toasts/loading in your own logic.

---

## What you get back

`useThreadHistoryActions()` → `ComputedRef<ThreadHistoryAction[]>` where each action includes:

| Property  | Type                                 | Description                              |
| --------- | ------------------------------------ | ---------------------------------------- | --------------- |
| `id`      | `string`                             | Unique identifier.                       |
| `icon`    | `string`                             | Iconify name to display in the dropdown. |
| `label`   | `string`                             | Action text shown next to the icon.      |
| `order`   | `number \| undefined`                | Sorting hint (default 200).              |
| `handler` | `(ctx: { document: Thread }) => void | Promise<void>`                           | Click callback. |

---

## Under the hood

1. **Global registry** – Uses `globalThis.__or3ThreadHistoryActionsRegistry` so multiple imports share the same entries.
2. **Reactive mirror** – Maintains `reactiveList.items` for Vue to track updates without making the map reactive.
3. **Sorting** – The computed accessor sorts by `order` each time, keeping render order deterministic.
4. **HMR-safe** – Overwriting the same ID just replaces the entry; dev warnings can be added similarly to other registries if needed.

---

## Edge cases & tips

-   **Duplicate IDs**: Last registration wins. Use `listRegisteredThreadHistoryActionIds()` to inspect the registry.
-   **Missing thread**: Ensure components pass the correct `Thread` to handlers; the registry doesn’t enforce schema.
-   **Async errors**: Catch and surface toast messages yourself—the registry doesn’t handle failure reporting.
-   **Order buckets**: Follow the convention (built-ins ~100–150, extensions ≥200) for predictable placement.

---

## Related

-   `useDocumentHistoryActions` — sister registry for documents.
-   `useThreadSearch` — locate threads for history UI.
-   `~/app/components/sidebar/ThreadHistory.vue` — consumes this registry to render dropdown actions.

---

## TypeScript

```ts
interface ThreadHistoryAction {
    id: string;
    icon: string;
    label: string;
    order?: number;
    handler: (ctx: { document: Thread }) => void | Promise<void>;
}
```
