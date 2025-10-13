# useComposerActions

Composer action registry powering the quick-action buttons beneath the chat composer. Lets plugins add buttons that hook into the active editor, thread, or pane context with visibility and disabled logic.

---

## What does it do?

`useComposerActions` manages a global list of composer actions:

-   `registerComposerAction()` adds or replaces an action definition.
-   `useComposerActions(contextFn)` returns a computed list of actions + disabled state derived from the current pane.
-   `unregisterComposerAction()` cleans up during teardown/HMR.
-   `listRegisteredComposerActionIds()` helps debug what’s registered.

Actions can check editor state, streaming status, thread IDs, etc., and render with retro-friendly icons and colors.

---

## Basic Example

```ts
import {
    registerComposerAction,
    unregisterComposerAction,
    useComposerActions,
} from '~/composables/sidebar/useComposerActions';

registerComposerAction({
    id: 'custom:clear-editor',
    icon: 'i-ph-broom',
    label: 'Clear',
    color: 'warning',
    order: 180,
    handler: ({ editor }) => editor?.commands.clearContent(),
    disabled: ({ editor }) => !editor || editor.isEmpty,
});

const actions = useComposerActions(() => ({ editor: editorRef.value }));

onScopeDispose(() => unregisterComposerAction('custom:clear-editor'));
```

---

## How to use it

### 1. Register actions during setup

Call `registerComposerAction()` in a plugin or component. Namespace IDs (`your-plugin:action`) to avoid collisions. The composable freezes your payload to prevent accidental mutation.

### 2. Provide context to consumers

`useComposerActions(contextFn)` accepts a function returning the latest `ComposerActionContext` (editor ref, thread ID, streaming flag, etc.). When context values change, the computed array updates automatically.

### 3. Control visibility and disabled state

-   `visible(ctx)` hides the button when it returns `false`.
-   `disabled(ctx)` grays it out while keeping it in the layout.

Both callbacks run every render, so keep logic fast and side-effect free.

### 4. Handle clicks

`handler(ctx)` executes when the button is clicked. You can return a promise to perform async work (e.g., API calls). The UI doesn’t await by default—manage loading state externally if needed.

### 5. Clean up on unmount/HMR

Always call `unregisterComposerAction()` (or use `useHookEffect`) to avoid duplicate buttons when modules reload.

---

## What you get back

`useComposerActions(contextFn)` returns a `ComputedRef<ComposerActionEntry[]>`. Each entry includes the original `action` plus a `disabled` flag evaluated against the latest context.

| Property   | Type                                  | Description                                |
| ---------- | ------------------------------------- | ------------------------------------------ | --------------- |
| `id`       | `string`                              | Unique identifier.                         |
| `icon`     | `string`                              | Iconify name rendered in the composer bar. |
| `tooltip`  | `string \| undefined`                 | Optional hover text.                       |
| `label`    | `string \| undefined`                 | Optional button label.                     |
| `order`    | `number \| undefined`                 | Sorting hint (defaults to 200).            |
| `color`    | `ChromeActionColor \| undefined`      | Nuxt UI color token for button styling.    |
| `handler`  | `(ctx: ComposerActionContext) => void | Promise<void>`                             | Click callback. |
| `visible`  | `(ctx) => boolean`                    | Optional visibility predicate.             |
| `disabled` | `(ctx) => boolean`                    | Optional disabled predicate.               |

---

## API

```ts
registerComposerAction(action: ComposerAction): void;
unregisterComposerAction(id: string): void;
useComposerActions(context?: () => ComposerActionContext): ComputedRef<ComposerActionEntry[]>;
listRegisteredComposerActionIds(): string[];
```

---

## Under the hood

1. **Global registry** – Stores actions on `globalThis.__or3ComposerActionsRegistry`, ensuring a single source of truth across imports.
2. **Reactive list** – Mirrors the map with a Vue `reactive` wrapper so computed consumers react to updates.
3. **Sorting** – Ensures deterministic order via `order ?? 200` ascending.
4. **Immutability** – Actions are `Object.freeze`d to prevent accidental runtime mutation after registration.

---

## Edge cases & tips

-   **Duplicate IDs**: Later registrations overwrite earlier ones; dev mode logs a warning.
-   **Missing context**: All predicates receive an empty object if you omit `contextFn`—guard for undefined fields.
-   **Async errors**: Handlers should catch their own errors and show toasts; the registry doesn’t intercept failures.
-   **Streaming state**: Use `isStreaming` to disable actions while the AI is responding.

---

## Related

-   `useHeaderActions` — similar registry for the sidebar header buttons.
-   `useSidebarSections` — adds custom panels and footer actions to the chrome.
-   `~/app/components/chat` — consumes composer actions to render the button row.

---

## TypeScript

```ts
interface ComposerActionContext {
    editor?: Editor | null;
    threadId?: string | null;
    paneId?: string | null;
    isStreaming?: boolean;
}

interface ComposerAction {
    id: string;
    icon: string;
    tooltip?: string;
    label?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: ComposerActionContext) => void | Promise<void>;
    visible?: (ctx: ComposerActionContext) => boolean;
    disabled?: (ctx: ComposerActionContext) => boolean;
}
```
