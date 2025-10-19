# useEditorNodes

Registry trio that lets plugins add TipTap nodes, marks, and extensions to the OR3 editor without patching the core component. Maintains global maps, keeps ordering stable, and plays nicely with HMR.

---

## Purpose

`useEditorNodes` exports helpers that manage three registries:

-   `registerEditorNode` / `listEditorNodes` for TipTap `Node` extensions.
-   `registerEditorMark` / `listEditorMarks` for TipTap `Mark` extensions.
-   `registerEditorExtension` / `listEditorExtensions` for generic TipTap extensions.

Each registry sorts entries by `order` (default 200) and stores them on `globalThis` so reloads don’t duplicate items.

---

## Basic Example

```ts
import BulletList from '@tiptap/extension-bullet-list';
import Italic from '@tiptap/extension-italic';
import CharacterCount from '@tiptap/extension-character-count';
import {
    registerEditorNode,
    registerEditorMark,
    registerEditorExtension,
    unregisterEditorNode,
} from '~/composables/editor/useEditorNodes';

registerEditorNode({
    id: 'custom:bullet-list',
    extension: BulletList,
    order: 180,
});

registerEditorMark({
    id: 'custom:italic',
    extension: Italic,
});

registerEditorExtension({
    id: 'custom:char-count',
    extension: CharacterCount.configure({ limit: 2000 }),
});

onScopeDispose(() => {
    unregisterEditorNode('custom:bullet-list');
});
```

---

## How to use it

### 1. Pick the right registry

-   Use `registerEditorNode()` for block/inline nodes (paragraphs, lists, embeds).
-   Use `registerEditorMark()` for text marks (bold, italic, highlights).
-   Use `registerEditorExtension()` for plugins that don’t fit either bucket (history, collaboration, etc.).

### 2. Provide a unique ID

Namespace IDs (e.g., `your-plugin:node`) so duplicate registrations override intentionally.

### 3. Set ordering if needed

-   Built-ins typically occupy the <200 range. Lower values appear earlier when the editor component iterates.
-   Leave `order` undefined to slot your extension after core ones.

### 4. Clean up on dispose

Call the matching `unregister*` helper during HMR or component teardown to prevent stale entries.

### 5. Consume from the editor shell

`listEditorNodes()`, `listEditorMarks()`, and `listEditorExtensions()` return sorted arrays—`DocumentEditor.vue` reads them to build the TipTap instance.

---

## API

```ts
registerEditorNode(node: EditorNode): void;
unregisterEditorNode(id: string): void;
listEditorNodes(): EditorNode[];
listRegisteredEditorNodeIds(): string[];

registerEditorMark(mark: EditorMark): void;
unregisterEditorMark(id: string): void;
listEditorMarks(): EditorMark[];
listRegisteredEditorMarkIds(): string[];

registerEditorExtension(ext: EditorExtension): void;
unregisterEditorExtension(id: string): void;
listEditorExtensions(): EditorExtension[];
listRegisteredEditorExtensionIds(): string[];
```

---

## Under the hood

1. **Global maps** – Registries live on `globalThis.__or3Editor*Registry`, so multiple imports share the same data and HMR doesn’t double-register.
2. **Reactive mirrors** – `reactiveList` objects mirror each map so Vue can track changes when lists are recomputed.
3. **Stable sorting** – Items sort by `order` with a secondary `id` tie-breaker for deterministic output.
4. **Dev warnings** – In dev mode, double registration logs a warning to help catch collisions early.

---

## Edge cases & tips

-   **Duplicate IDs**: Later registrations replace earlier ones. Use this intentionally for overrides, otherwise rename your extension.
-   **Mark vs extension**: Some TipTap packages export both mark + helper. Register whichever type your editor setup expects.
-   **SSR safety**: Registries initialise lazily and don’t touch browser-only APIs, so they’re safe during server rendering.
-   **Cleanup**: Forgetting to unregister during HMR can leave stale marks that break tests; wrap registrations in `useHookEffect` to automate cleanup.

---

## Related

-   `useEditorToolbar` — complementary registry for toolbar buttons.
-   `~/app/components/editor/DocumentEditor.vue` — consumes these lists when building the TipTap instance.
-   `~/utils/editor/` — shared helpers for configuring extensions.

---

## TypeScript

```ts
interface EditorNode {
    id: string;
    extension: Node;
    order?: number;
}

interface EditorMark {
    id: string;
    extension: Mark;
    order?: number;
}

interface EditorExtension {
    id: string;
    extension: Extension;
    order?: number;
}
```
