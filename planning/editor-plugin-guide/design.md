# Editor Extensibility Design

artifact_id: 5f2b9b6e-27a2-4e60-9cf7-cc7a7b41a8f9

## Overview

Provide a lightweight, HMR-safe registry and hook layer so OR3 plugins (Nuxt .client.ts) can register TipTap nodes, marks, and toolbar buttons without changing core files. This already exists in `app/composables/ui-extensions/editor/useEditorToolbar.ts` and `app/composables/ui-extensions/editor/useEditorNodes.ts`. The `DocumentEditor.vue` collects these registrations to instantiate the Editor. A minimal hook bus exposes lifecycle events for advanced customization.

## Architecture

High-level flow:

```mermaid
flowchart TD
  A[Nuxt app start] --> B[Nuxt plugin files *.client.ts]
  B -->|registerEditorToolbarButton| R[(Global Registry)]
  B -->|registerEditorNode| R
  B -->|registerEditorMark| R
  C[DocumentEditor.vue] -->|listEditorNodes/Marks| R
  C -->|useEditorToolbarButtons(editorRef)| R
  C --> D[TipTap Editor Instance]
  D -->|created| H[Hooks: editor.created]
  D -->|onUpdate| H2[Hooks: editor.updated]
  Plugins -->|hooks.addAction| H
  Plugins -->|hooks.addAction| H2
```

Core components (as implemented):

-   Registries: Global Maps for toolbar buttons, nodes, and marks (HMR-safe) with replace-by-id semantics and order sorting (see files above).
-   Composables: Public APIs to register/unregister/list items and to compute toolbar buttons reactively (`useEditorToolbarButtons`).
-   Hooks: Lightweight action registry broadcasting editor lifecycle events (to be emitted from `DocumentEditor.vue`).
-   DocumentEditor: Reads registries to build the Editor extensions and toolbar.

## Components and Interfaces

Public TS interfaces (already present in composables):

```ts
// Toolbar Buttons
export interface EditorToolbarButton {
    id: string;
    icon: string;
    tooltip?: string;
    order?: number; // default 200
    isActive?: (editor: Editor) => boolean;
    visible?: (editor: Editor) => boolean;
    onClick: (editor: Editor) => void | Promise<void>;
}

// Nodes and Marks
export interface EditorNode {
    id: string;
    extension: Extension;
    order?: number;
}
export interface EditorMark {
    id: string;
    extension: Extension;
    order?: number;
}

// Service Result
// Note: No ServiceResult wrapper is required by the current code. Registrations log warnings in dev and update reactive lists.
```

Registry contract:

```ts
// Global backing store to survive HMR
type GlobalRegistries = {
    editorToolbar: Map<string, EditorToolbarButton>;
    editorNodes: Map<string, EditorNode>;
    editorMarks: Map<string, EditorMark>;
};

declare global {
    // d.ts augmentation already present in project style
    // eslint-disable-next-line no-var
    var __or3EditorRegistries: GlobalRegistries | undefined;
}

function getRegistries(): GlobalRegistries {
    if (!globalThis.__or3EditorRegistries) {
        globalThis.__or3EditorRegistries = {
            editorToolbar: new Map(),
            editorNodes: new Map(),
            editorMarks: new Map(),
        };
    }
    return globalThis.__or3EditorRegistries;
}
```

Registration functions are implemented in the codebase with dev-time overwrite warnings and reactive list syncing. No additional wrapper is planned to avoid duplication.

Toolbar computed composable is implemented as `useEditorToolbarButtons(editorRef)`. We may add defensive try/catch around `visible`/`isActive` in a future hardening pass (see Error Handling) without changing the API.

Editor integration (already in `DocumentEditor.vue`):

-   Collect nodes/marks via `listEditorNodes()` and `listEditorMarks()` and spread them into the `extensions` array when constructing `new Editor({...})`.
-   Emit lifecycle hooks via the hook bus on create and onUpdate.

## Hooks Design

We leverage the existing `useHooks()` system and add two actions if not present:

-   `editor.created:action:after` payload: `{ editor: Editor }`
-   `editor.updated:action:after` payload: `{ editor: Editor, json?: JSONContent }`

Emission points:

-   After `editor.value = new Editor(...)` is created, fire `editor.created:action:after`.
-   In `onUpdate`, after `emitContent()`, fire `editor.updated:action:after` with a minimal payload (e.g., editor instance). Including JSON can be added later behind a flag if needed.

## Data Models

No database persistence changes. All data is in-memory registries on `globalThis` and reactive refs.

## Error Handling

-   Validation of required fields is minimal today; dev warnings exist on overwrite. We will add defensive try/catch around `visible`, `isActive`, and `onClick` to avoid toolbar/editor crashes.
-   During editor init, consider wrapping extension assembly in try/catch per extension to isolate failures. This can be an incremental improvement without changing the public API.

## Testing Strategy

-   Unit tests

    -   Register/unregister buttons, nodes, marks; ensure deduplication and ordering.
    -   Verify listRegistered\*Ids output and stability of ordering.
    -   Simulate HMR by re-registering same id; ensure replacement.
    -   Guard visible/isActive exceptions are handled.

-   Integration tests

    -   Mount a minimal component that constructs an Editor with plugin nodes/marks and ensures they appear in the schema and commands work.
    -   Render toolbar with useEditorToolbarButtons and trigger onClick paths.

-   E2E (optional)

    -   A demo plugin under app/plugins/examples exercising a node, a mark, and a button.

-   Performance
    -   Measure editor creation time with 0, 10, 30 plugin extensions; assert budget.

## Security Considerations

-   Do not allow arbitrary HTML injection from plugin APIs; the TipTap extension model already constrains DOM rendering paths.
-   Ensure no SSR execution path by encouraging `.client.ts` and no-op on server.

## Notes

-   Keep APIs minimal and stable. Prefer additive changes to avoid breaking existing plugins.
-   Built-in items should use order < 200 to consistently appear before plugins.
