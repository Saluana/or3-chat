# useHeaderActions

Sidebar header action registry that powers the icon buttons in the chrome header (new thread, toggle layout, etc.). Lets plugins contribute actions that react to route, breakpoint, or custom context.

---

## What does it do?

`useHeaderActions` wraps the shared registry factory to provide:

-   `registerHeaderAction()` / `unregisterHeaderAction()` for lifecycle management.
-   `useHeaderActions(contextFn)` to compute filtered, ordered buttons with disabled state applied.
-   `listRegisteredHeaderActionIds()` for debugging.

Actions can adjust styling via `color`, display tooltips, and opt into mobile-only/desktop-only modes.

---

## Basic Example

```ts
import {
    registerHeaderAction,
    unregisterHeaderAction,
    useHeaderActions,
} from '~/composables/sidebar/useHeaderActions';

registerHeaderAction({
    id: 'custom:toggle-projects',
    icon: 'i-ph-folders',
    tooltip: 'Toggle projects',
    order: 160,
    visible: ({ isMobile }) => !isMobile,
    handler: () => emitToggleProjects(),
});

const actions = useHeaderActions(() => ({ route: useRoute(), isMobile }));

onScopeDispose(() => unregisterHeaderAction('custom:toggle-projects'));
```

---

## How to use it

### 1. Register actions on startup

-   Namespace IDs to avoid clobbering built-ins.
-   Provide `icon`, optional `tooltip`, `label`, `color`, and `order`.

### 2. Feed context into `useHeaderActions`

`contextFn` should return whatever inputs your predicates need (e.g., current `route`, `isMobile` flag from `useBreakpoints`). The computed list recalculates whenever the returned values change.

### 3. Control visibility and disabled state

-   `visible(ctx)` returns `false` to hide the button entirely.
-   `disabled(ctx)` greys out the button but keeps tooltip + layout.

### 4. Handle clicks

`handler(ctx)` can perform sync or async work. Manage your own loading indicators—you can combine with `disabled` toggles if necessary.

### 5. Cleanup during teardown

Call `unregisterHeaderAction()` (or use `useHookEffect`) to avoid duplicates under HMR.

---

## What you get back

`useHeaderActions(contextFn)` returns a `ComputedRef<HeaderActionEntry[]>` where each entry includes the original action plus evaluated `disabled` state.

| Property   | Type                                | Description                                  |
| ---------- | ----------------------------------- | -------------------------------------------- | -------------- |
| `id`       | `string`                            | Unique identifier.                           |
| `icon`     | `string`                            | Iconify name for the header button.          |
| `tooltip`  | `string \| undefined`               | Hover/focus hint.                            |
| `label`    | `string \| undefined`               | Optional text label beside the icon.         |
| `order`    | `number \| undefined`               | Sort order (default 200).                    |
| `color`    | `ChromeActionColor \| undefined`    | Styling hint passed to the button component. |
| `handler`  | `(ctx: HeaderActionContext) => void | Promise<void>`                               | Click handler. |
| `visible`  | `(ctx) => boolean`                  | Optional visibility predicate.               |
| `disabled` | `(ctx) => boolean`                  | Optional disabled predicate.                 |

---

## API

```ts
registerHeaderAction(action: HeaderAction): void;
unregisterHeaderAction(id: string): void;
useHeaderActions(context?: () => HeaderActionContext): ComputedRef<HeaderActionEntry[]>;
listRegisteredHeaderActionIds(): string[];
```

---

## Under the hood

1. **Registry factory** – Uses `createRegistry('__or3HeaderActionsRegistry')` which already handles dedupe, sorting, and reactivity.
2. **Default ordering** – Applies `order ?? 200` so plugin buttons usually land after built-ins unless you specify otherwise.
3. **Context-driven filtering** – Runs `visible`/`disabled` functions for every render; errors aren’t caught here, so write defensive code if predicates touch optional fields.
4. **Shared list** – All imports share the same global registry, making it safe to register from multiple modules.

---

## Edge cases & tips

-   **Mobile-only actions**: Pair `visible` with your responsive breakpoints to hide controls on smaller layouts.
-   **Route-dependent actions**: Use `route.name` or `route.path` inside predicates to only show actions on relevant pages.
-   **Async state**: If a handler triggers network work, consider disabling the button until the promise resolves.
-   **Testing**: Mock `createRegistry` or inject a fake registry when writing unit tests to keep them deterministic.

---

## Related

-   `useComposerActions` — handles composer button row.
-   `useSidebarSections` — adds custom sidebar panels and footer actions.
-   `~/composables/_registry` — shared factory powering these registries.

---

## TypeScript

```ts
interface HeaderActionContext {
    route?: RouteLocationNormalizedLoaded | null;
    isMobile?: boolean;
}

interface HeaderAction extends RegistryItem {
    id: string;
    icon: string;
    tooltip?: string;
    label?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: HeaderActionContext) => void | Promise<void>;
    visible?: (ctx: HeaderActionContext) => boolean;
    disabled?: (ctx: HeaderActionContext) => boolean;
}
```
