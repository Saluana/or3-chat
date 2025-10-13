# useDocumentHistoryActions

Registry composable that lets plugins inject extra actions into the document history sidebar menu. Keeps a global list of action buttons, sorts them, and survives HMR so dashboard add-ons can extend the UI safely.

---

## What does it do?

`useDocumentHistoryActions` powers the dropdown on each document history item:

-   `registerDocumentHistoryAction()` adds or replaces an action definition.
-   `useDocumentHistoryActions()` returns a sorted, reactive array of actions for rendering.
-   `unregisterDocumentHistoryAction()` removes actions during cleanup to avoid duplicates.
-   `listRegisteredDocumentHistoryActionIds()` helps authors inspect what’s already registered.

Because the registry lives on `globalThis`, the set of actions persists across hot reloads and SSR hydration.

---

## Basic Example

```ts
import {
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
    useDocumentHistoryActions,
} from '~/composables/documents/useDocumentHistoryActions';

registerDocumentHistoryAction({
    id: 'export-pdf',
    icon: 'i-ph-file-pdf',
    label: 'Export as PDF',
    order: 210,
    async handler({ document }) {
        await exportDocumentToPdf(document.id);
    },
});

const actions = useDocumentHistoryActions();

onScopeDispose(() => {
    unregisterDocumentHistoryAction('export-pdf');
});
```

---

## How to use it

### 1. Register on startup or inside a hook

Call `registerDocumentHistoryAction()` when your plugin initialises. Use `useHookEffect()` if you need automatic cleanup on HMR/unmount.

### 2. Provide a unique ID and icon

-   Prefix IDs with your namespace (`my-plugin:download`) to avoid conflicts.
-   Supply an Iconify name that fits the retro UI.

### 3. Handle the click

The handler receives `{ document }` where `document` is the Dexie `Post` record. Perform async work freely; the dropdown stays responsive.

### 4. Render the actions

Components like the document sidebar call `useDocumentHistoryActions()` to read the current list. You can do the same to inject actions into custom UIs or tests.

---

## What you get back

`useDocumentHistoryActions()` returns a computed ref sorted by `order` (default 200), so lower numbers appear first.

| Property  | Type                                                 | Description                        |
| --------- | ---------------------------------------------------- | ---------------------------------- |
| `id`      | `string`                                             | Unique identifier for the action.  |
| `icon`    | `string`                                             | Iconify name rendered in the menu. |
| `label`   | `string`                                             | Button text shown in the dropdown. |
| `order`   | `number \| undefined`                                | Placement hint (defaults to 200).  |
| `handler` | `(ctx: { document: Post }) => void \| Promise<void>` | Click callback.                    |

---

## API

```ts
registerDocumentHistoryAction(action: DocumentHistoryAction): void;
unregisterDocumentHistoryAction(id: string): void;
useDocumentHistoryActions(): ComputedRef<DocumentHistoryAction[]>;
listRegisteredDocumentHistoryActionIds(): string[];
```

---

## Under the hood

1. **Global map** – Stores actions on `globalThis.__or3DocumentHistoryActionsRegistry` to persist across reloads.
2. **Reactive mirror** – Maintains `reactiveList.items` so Vue can track changes without making the map reactive.
3. **Sorting** – Consumers sort by `order` on every read, ensuring deterministic menus.
4. **HMR-safe** – Re-registering an existing ID simply replaces the entry; dev mode can warn upstream.

---

## Edge cases & tips

-   **Duplicate IDs**: Later registrations replace earlier ones. If that’s unintentional, inspect `listRegisteredDocumentHistoryActionIds()`.
-   **Order gaps**: You don’t need consecutive numbers—stick to buckets (100 built-ins, 200 extensions, etc.).
-   **Cleanup**: Always unregister on scope dispose to avoid stale actions when HMR tears down modules.
-   **Error handling**: Wrap handler logic in try/catch and surface toast notifications yourself; the registry doesn’t swallow errors.

---

## Related

-   `useHookEffect` — ideal for registering/unregistering actions inside plugin lifecycles.
-   `~/app/components/sidebar/DocumentHistory.vue` — renders the menu that consumes this registry.
-   `~/db/posts` — source type for the `document` payload.

---

## TypeScript

```ts
interface DocumentHistoryAction {
    id: string;
    icon: string;
    label: string;
    order?: number;
    handler: (ctx: { document: Post }) => void | Promise<void>;
}
```
