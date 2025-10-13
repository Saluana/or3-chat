# useEditorToolbar

Toolbar registry for the TipTap editor. Lets plugins add buttons, toggles, or dropdowns to the retro editor header while keeping the UI reactive and order-aware.

---

## What does it do?

`useEditorToolbar` exposes helpers to manage toolbar buttons:

-   `registerEditorToolbarButton()` adds or replaces a button definition.
-   `useEditorToolbarButtons(editorRef)` returns a computed, filtered, and sorted array of buttons ready to render.
-   `unregisterEditorToolbarButton()` cleans up during teardown/HMR.
-   `listRegisteredEditorToolbarButtonIds()` lets authors inspect the registry.

Buttons can customise visibility, active state, icons, ordering, and click behaviour.

---

## Basic Example

```ts
import Bold from '@tiptap/extension-bold';
import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    useEditorToolbarButtons,
} from '~/composables/editor/useEditorToolbar';
import { registerEditorMark } from '~/composables/editor/useEditorNodes';

registerEditorMark({ id: 'custom:bold', extension: Bold });

registerEditorToolbarButton({
    id: 'custom:bold-toggle',
    icon: 'i-ph-text-b',
    tooltip: 'Bold (⌘B)',
    order: 150,
    isActive: (editor) => editor.isActive('bold'),
    onClick: (editor) => editor.chain().focus().toggleBold().run(),
});

const buttons = useEditorToolbarButtons(editorRef);

onScopeDispose(() => {
    unregisterEditorToolbarButton('custom:bold-toggle');
});
```

---

## How to use it

### 1. Register buttons during setup

Call `registerEditorToolbarButton()` inside a plugin or component. Namespace IDs to avoid clashes (`my-plugin:bold`).

### 2. Implement handlers

-   `onClick` receives the live TipTap editor instance—chain commands, toggle marks, etc.
-   `isActive` marks buttons as pressed (useful for toggles).
-   `visible` hides buttons conditionally (e.g., based on editor capabilities).

Wrap logic in try/catch if the command could fail; errors bubble to the console in dev but won’t break rendering.

### 3. Consume in the toolbar component

Pass a ref to the current `Editor` instance into `useEditorToolbarButtons()`. The computed result auto-updates when visibility changes (e.g., selection context).

### 4. Order buttons

-   Built-ins generally occupy <200 slots.
-   Set `order` to insert before/after core controls; ties fall back to `id` alphabetical order.

### 5. Clean up for HMR

Call `unregisterEditorToolbarButton()` during teardown to avoid duplicates when modules hot reload.

---

## What you get back

`useEditorToolbarButtons(editorRef)` returns a `ComputedRef<EditorToolbarButton[]>`. Each button contains:

| Property   | Type                          | Description                                          |
| ---------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `id`       | `string`                      | Unique identifier.                                   |
| `icon`     | `string`                      | Iconify name shown in the retro toolbar.             |
| `tooltip`  | `string \| undefined`         | Hover hint.                                          |
| `order`    | `number \| undefined`         | Controls placement (default 200).                    |
| `isActive` | `(editor: Editor) => boolean` | Optional active state tester.                        |
| `onClick`  | `(editor: Editor) => void     | Promise<void>`                                       | Executes when the button is clicked. |
| `visible`  | `(editor: Editor) => boolean` | Optional visibility predicate; hidden on exceptions. |

---

## API

```ts
registerEditorToolbarButton(button: EditorToolbarButton): void;
unregisterEditorToolbarButton(id: string): void;
useEditorToolbarButtons(editorRef: Ref<Editor | null>): ComputedRef<EditorToolbarButton[]>;
listRegisteredEditorToolbarButtonIds(): string[];
```

---

## Under the hood

1. **Global map** – Buttons live on `globalThis.__or3EditorToolbarRegistry`, preventing duplicate registrations across imports/HMR.
2. **Reactive mirror** – A reactive list mirrors the map so Vue recomputes consumer arrays automatically.
3. **Visibility guard** – `useEditorToolbarButtons` filters buttons through their `visible` callback inside a try/catch; errors default to hiding the button.
4. **Stable sort** – Buttons sort by `order` with a secondary `id` tie-breaker for deterministic output.

---

## Edge cases & tips

-   **No editor yet**: When `editorRef.value` is `null`, the computed array is empty—render guards should handle this gracefully.
-   **Async handlers**: Returning a promise is supported; UI code can await if needed (e.g., to show loading states).
-   **Keyboard shortcuts**: Pair buttons with TipTap commands bound via `editor.registerPlugin` or external shortcut handlers.
-   **Testing**: In Vitest, provide a mocked editor object with the minimal API (`chain`, `isActive`) to test your buttons.

---

## Related

-   `useEditorNodes` — register complementary nodes/marks.
-   `~/app/components/editor/DocumentEditorToolbar.vue` — consumes the toolbar registry.
-   `@tiptap/vue-3` — TipTap editor integration referenced by button handlers.

---

## TypeScript

```ts
interface EditorToolbarButton {
    id: string;
    icon: string;
    tooltip?: string;
    order?: number;
    isActive?: (editor: Editor) => boolean;
    onClick: (editor: Editor) => void | Promise<void>;
    visible?: (editor: Editor) => boolean;
}
```
