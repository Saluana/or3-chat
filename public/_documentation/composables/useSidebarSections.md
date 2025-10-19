# useSidebarSections

Sidebar chrome registry that lets plugins add new panels (top/main/bottom stacks) and footer actions to the OR3 sidebar. Provides ordering, placement, visibility, and disabled control.

---

## What does it do?

`useSidebarSections` exposes two registries via the shared `_registry` factory:

-   Section registry: `registerSidebarSection()` / `useSidebarSections()` groups components by placement (`top`, `main`, `bottom`).
-   Footer action registry: `registerSidebarFooterAction()` / `useSidebarFooterActions()` manages button-style actions rendered in the sidebar footer.

Both registries share ordering semantics and dedupe logic.

---

## Basic Example

```ts
import {
    registerSidebarSection,
    unregisterSidebarSection,
    useSidebarSections,
    registerSidebarFooterAction,
    unregisterSidebarFooterAction,
} from '~/composables/sidebar/useSidebarSections';

registerSidebarSection({
    id: 'custom:tips',
    component: () => import('~/components/sidebar/TipsPanel.vue'),
    placement: 'bottom',
    order: 210,
});

registerSidebarFooterAction({
    id: 'custom:new-project',
    icon: 'i-ph-plus-circle',
    label: 'New Project',
    color: 'primary',
    handler: () => openNewProjectModal(),
});

const sections = useSidebarSections();
const footerActions = useSidebarFooterActions(() => ({
    activeThreadId: currentThreadId.value,
}));

onScopeDispose(() => {
    unregisterSidebarSection('custom:tips');
    unregisterSidebarFooterAction('custom:new-project');
});
```

---

## How to use it

### 1. Register sections

-   Provide a unique `id`, a Vue component (sync or async factory), optional `order`, and `placement`.
-   Default placement is `'main'`, which renders inside the primary scroll stack.
-   Sections are rendered as-is, so handle loading states internally for async components.

### 2. Register footer actions

-   Define Iconify `icon`, optional `label`, `tooltip`, `color`, and `order`.
-   `visible(ctx)` and `disabled(ctx)` let you tailor actions to the active thread/document or collapsed sidebar state.

### 3. Consume registries

-   `useSidebarSections()` returns a computed object `{ top, main, bottom }`, each sorted by `order`.
-   `useSidebarFooterActions(contextFn)` returns a computed array of `{ action, disabled }` entries based on the latest context.

### 4. Clean up

Call the matching `unregister*` helpers during scope disposal/HMR to prevent duplicates.

---

## What you get back

### Sections

`useSidebarSections()` → `ComputedRef<{ top: SidebarSection[]; main: SidebarSection[]; bottom: SidebarSection[] }>`

### Footer actions

`useSidebarFooterActions(contextFn)` → `ComputedRef<SidebarFooterActionEntry[]>`

Each `SidebarFooterActionEntry` contains the original action and `disabled` boolean.

---

## Under the hood

1. **Registry factory** – Uses `createRegistry('__or3SidebarSectionsRegistry')` and `createRegistry('__or3SidebarFooterActionsRegistry')`, which handle reactivity, sorting, and deduping.
2. **Default ordering** – Applies `order ?? 200` for deterministic placement relative to built-ins.
3. **Placement split** – The `useSidebarSections()` computed buckets entries by `placement` before sorting.
4. **Context evaluation** – Footer actions evaluate `visible`/`disabled` with the provided context function each render.

---

## Edge cases & tips

-   **Async components**: When `component` is a lazy import, Nuxt handles suspense; consider showing an internal loading indicator for better UX.
-   **Collapsed sidebar**: Use the `isCollapsed` flag inside footer action predicates to hide text-heavy buttons.
-   **Multiple registrations**: Re-registering with the same `id` replaces the previous entry—handy for overrides.
-   **Testing**: Mock `createRegistry` for deterministic unit tests.

---

## Related

-   `useHeaderActions` — header button registry sharing the same pattern.
-   `useComposerActions` — controls the chat composer quick actions.
-   `~/composables/_registry` — factory implementing the registry mechanics.

---

## TypeScript

```ts
type SidebarSectionPlacement = 'top' | 'main' | 'bottom';

interface SidebarSection extends RegistryItem {
    id: string;
    component: Component | (() => Promise<any>);
    order?: number;
    placement?: SidebarSectionPlacement;
}

type ChromeActionColor =
    | 'neutral'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'inverse-primary'
    | (string & {});

interface SidebarFooterAction extends RegistryItem {
    id: string;
    icon: string;
    label?: string;
    tooltip?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: SidebarFooterActionContext) => void | Promise<void>;
    visible?: (ctx: SidebarFooterActionContext) => boolean;
    disabled?: (ctx: SidebarFooterActionContext) => boolean;
}
```
