artifact_id: fd07b75b-fec4-4b44-a3a7-bd7c48f6c2fd
content_type: text/markdown

# requirements.md

## Purpose

Define the minimum surface changes required to let external plugins deliver “Custom Pane Apps” that render inside the existing multi-pane workspace, reuse the shared `posts` table, and ship with a sidebar entry point—without refactoring core chat/doc flows or adding new persistence layers.

## Stakeholders & Primary Scenarios

-   **Plugin authors** want to register a pane app (`todo`, `crm`, etc.), auto-create backing `posts` rows, and render a Vue component when the pane is active.
-   **Core UX** must keep chat and docs untouched while allowing new pane modes to co-exist in split view.
-   **Data layer** needs a minimal CRUD bridge so plugins read/write their own `postType` records using `meta` blobs.

## Functional Requirements

1. **Pane mode generalization**
    -   `PaneState.mode` SHALL accept arbitrary string identifiers while keeping `'chat'` and `'doc'` behaviour identical.
    -   Existing helpers (`setPaneThread`, document flush hooks, route sync) SHALL continue to operate for legacy modes without extra branching.

2. **Pane app registry**
    -   Provide `usePaneApps()` returning `{ registerPaneApp, getPaneApp, listPaneApps }` backed by a global Map (same pattern as dashboard/sidebar registries).
    -   `PaneAppDef` MUST include `id`, `label`, `component`, optional `icon`, optional `postType` override, and optional async `createInitialRecord`.
    -   Multiple registrations of the same id SHALL replace the previous entry (development HMR parity with other registries).

3. **Pane creation API**
    -   Expose `newPaneForApp(appId: string, opts?)` on `__or3MultiPaneApi` that:
        1. Validates the app id.
        2. Creates a new pane with `mode = appId`.
        3. Runs `createInitialRecord()` when present and assigns its `id` to `pane.documentId`.
        4. Pushes the pane into the existing array and focuses it.
    -   Helper SHALL reject when pane limit reached (reuse current `canAddPane` guard) and bubble errors without swallowing them silently.

4. **Dynamic pane rendering**
    -   `PageShell.vue` SHALL resolve pane body components via a function that:
        -   Returns existing chat/doc components for built-in modes.
        -   Falls back to registered pane app component, if present.
        -   Shows a lightweight fallback when no renderer exists (e.g., “Unknown pane type”).
    -   Pane props for custom apps SHALL include `{ paneId, recordId (alias of documentId), postType, postApi }` to keep docs/chat props untouched.

5. **Posts CRUD bridge**
    -   Extend `pane-plugin-api.client.ts` with `posts` helpers:
        -   `create(postType, payload)` → `{ id }`.
        -   `update(id, patch)` → void.
        -   `listByType(postType)` → array of posts (stringified `meta` parsed to plain object when possible).
    -   Helpers MUST reuse existing Dexie wrappers (`db.posts`, `createPost`, `upsertPost`) and uphold hook firing (`db.posts.*` actions).
    -   API SHALL normalise `meta` so plugins always receive an object/array when source was JSON.

6. **Sidebar list helper (DX)**
    -   Add `registerSidebarPostList({ id, label, postType, placement?, order? })` that internally registers a sidebar section component rendering a live list via Dexie `liveQuery`.
    -   Provide a composable `usePostsList(postType, opts?)` to encapsulate subscription, sorting (most recent first), and soft-delete filtering.
    -   Clicking list items SHALL call `__or3MultiPaneApi.newPaneForApp(appId)` or reuse existing pane if already open (exact behaviour defined in design).

7. **Documentation & typing**
    -   Update developer docs (pane plugin API, sidebar extension docs) to reflect new hooks and helpers.
    -   Update TypeScript surfaces (`hook-types`, public docs) so new pane modes do not break current imports; prefer widening via string-branded types to keep `'chat' | 'doc'` autocomplete.

## Non-Functional Requirements

-   Changes MUST avoid affecting SSR or backend bundles (client-only registries, lazy imports where possible).
-   Additional runtime cost per pane render SHOULD remain negligible (simple resolver, no deep watchers).
-   Backwards compatibility: existing panes, hooks, tests, and URL sync MUST continue to work with no behaviour change when only `'chat'` and `'doc'` are used.
-   DX focus: plugin authors should write ≤20 lines to register a sidebar list + pane app, with zero core edits.

## Out of Scope (v1)

-   URL routing for custom panes (address bar continues to reflect last chat/doc route).
-   Sandboxing/permission boundaries for third-party components beyond current plugin model.
-   New multi-tenant data shapes or server APIs—storage remains `posts` table only.
-   Autosave utilities beyond exposing `posts.update` (plugins manage their own persistence cadence).
