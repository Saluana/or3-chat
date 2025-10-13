# useProjectTreeActions

Extensible action registry for the project tree sidebar. Lets plugins add context buttons to project rows or child entries (documents, chats) with ordering and visibility controls.

---

## What does it do?

`useProjectTreeActions` builds on the generic `createRegistry` utility to provide:

-   `registerProjectTreeAction()` to add or replace project tree actions.
-   `useProjectTreeActions()` to retrieve a reactive, sorted list of actions.
-   `unregisterProjectTreeAction()` for cleanup.
-   `listRegisteredProjectTreeActionIds()` to inspect current registrations.

Actions can target project roots, all rows, or specific child kinds (`chat`, `doc`) via `showOn` filters.

---

## Basic Example

```ts
import {
    registerProjectTreeAction,
    unregisterProjectTreeAction,
    useProjectTreeActions,
} from '~/composables/projects/useProjectTreeActions';

registerProjectTreeAction({
    id: 'custom:open-in-new-pane',
    icon: 'i-ph-squares-four',
    label: 'Open in new pane',
    order: 180,
    showOn: ['doc', 'chat'],
    async handler({ treeRow }) {
        if ('parentId' in treeRow) {
            await openEntryInFreshPane(treeRow.value);
        }
    },
});

const actions = useProjectTreeActions();

onScopeDispose(() => {
    unregisterProjectTreeAction('custom:open-in-new-pane');
});
```

---

## How to use it

### 1. Register an action

Call `registerProjectTreeAction()` when your plugin starts. Provide a unique `id`, Iconify `icon`, `label`, optional `order`, `showOn`, and an async-compatible `handler`.

### 2. Target specific rows

-   Omitting `showOn` shows the action everywhere.
-   Include `['root']` to limit to project rows.
-   Use `['doc']` or `['chat']` to target children representing documents or chat threads.

### 3. Handle the click

The handler receives `{ treeRow, child, root }`:

-   `treeRow` is always present and can be root or child.
-   `child` and `root` remain for legacy shapes—prefer `treeRow` moving forward.

### 4. Consume from the UI

`useProjectTreeActions()` returns a reactive array used by components like `SidebarProjectTree.vue`. You rarely call it yourself unless you render a custom tree UI.

### 5. Clean up

Call `unregisterProjectTreeAction()` during dispose to keep the registry tidy across HMR.

---

## API

```ts
registerProjectTreeAction(action: ProjectTreeAction): void;
unregisterProjectTreeAction(id: string): void;
useProjectTreeActions(): ComputedRef<ProjectTreeAction[]>;
listRegisteredProjectTreeActionIds(): string[];
```

---

## Under the hood

1. **Registry factory** – Uses `createRegistry('__or3ProjectTreeActionsRegistry')`, which already handles sorting, deduping, and reactivity.
2. **Ordering** – `createRegistry` sorts by `order` (default 200); ties fall back to registration order.
3. **HMR safe** – The registry lives on `globalThis`, so multiple imports share the same entries.
4. **Visibility filtering** – Consumers apply `showOn` checks before rendering buttons, ensuring minimal logic in handlers.

---

## Edge cases & tips

-   **Unknown `treeRow` shape**: Some legacy callers might pass `child`/`root`; guard your handler accordingly.
-   **Async errors**: Return promises and handle errors inside the handler—UI components don’t catch them automatically.
-   **Order collisions**: Use different `order` buckets to cluster your plugin’s actions together.
-   **Testing**: In Jest/Vitest, stub `createRegistry` with a local implementation if you want to isolate actual Dexie usage.

---

## Related

-   `useProjectsCrud` — manages the underlying Dexie project records.
-   `~/app/components/sidebar/SidebarProjectTree.vue` — consumes this registry to render contextual menus.
-   `~/utils/projects/normalizeProjectData` — helps keep tree rows consistent with stored data.

---

## TypeScript

```ts
type ProjectTreeKind = 'chat' | 'doc';
type ShowOnKind = 'root' | 'all' | 'chat' | 'doc';

interface ProjectTreeChild {
    value: string;
    label: string;
    icon?: string;
    kind?: ProjectTreeKind;
    parentId?: string;
    onSelect?: (e: Event) => void;
}

interface ProjectTreeRoot {
    value: string;
    label: string;
    defaultExpanded?: boolean;
    children?: ProjectTreeChild[];
    onSelect?: (e: Event) => void;
}

interface ProjectTreeAction {
    id: string;
    icon: string;
    label: string;
    order?: number;
    showOn?: ShowOnKind[];
    handler: (ctx: ProjectTreeHandlerCtx) => void | Promise<void>;
}
```
