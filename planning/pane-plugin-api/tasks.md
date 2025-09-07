# tasks.md

artifact_id: 6d3d621a-5a7b-4fc1-a6df-6d374b2335df

## 1. Create plugin API file

-   [x] Add `app/plugins/pane-plugin-api.client.ts` implementing global `__or3PanePluginApi`.
-   [x] Define `PanePluginApi` interface + helper `err` + `getPane`.
-   [x] Implement `sendMessage` with thread creation branch.
-   [x] Implement doc helpers: `updateDocumentContent`, `patchDocumentContent`, `setDocumentTitle`.
-   [x] Attach once (skip if already present) and log dev banner.

Requirements: 1,2,3,4,5,6,7,8,9,10,11,12

## 2. Implement shallow patch helper

-   [x] Local function inside plugin file (no export) performing limited merge rules described.
        Requirements: 4,12

## 3. Integrate with existing DB & hooks

-   [x] Import `create.thread`, `tx.appendMessage`.
-   [x] Import `useHooks` via `useNuxtApp().$hooks` access (avoid new composable instantiation).
-   [x] Fire `ui.pane.thread:action:changed` when creating thread.
-   [x] Fire `ui.pane.msg:action:sent` after append.
        Requirements: 1,2,8,9

## 4. Document mutation wiring

-   [x] Import `setDocumentContent`, `setDocumentTitle`, `useDocumentState` (for base JSON when patching) from `useDocumentsStore`.
-   [x] Implement patch fallback to empty root if none.
        Requirements: 3,4,5,9,12

## 5. Error handling & validation

-   [x] Implement guard for `source`.
-   [x] Implement code-based rejects per design (not_found, pane_not_chat, pane_not_doc, no_thread, missing_source, invalid_text).
-   [x] Uniform return shapes `{ ok:false,... }` or `{ ok:true,... }`.
        Requirements: 6,7

## 6. Types & minimal footprint

-   [x] Ensure file <= ~120 LOC (excluding comments). Keep comments brief.
        Requirements: 8,11,12

## 7. Tests

-   [x] Add `app/composables/__tests__/panePluginApi.test.ts` covering: existing thread send, create thread, missing pane, non-chat pane, missing source, doc replace, doc patch, title change, getActivePaneData.
-   [x] Mock minimal panes + global `__or3MultiPaneApi`.
-   [x] Spy on hooks.doAction invocations (implicit via hookEngine available; direct assertions can be added later if needed). - [x] Added mock for `defineNuxtPlugin` to allow plugin load under vitest.
        Requirements: 1-7,9,11

## 8. Docs Update (optional minimal)

-   [ ] Append short section to `docs/hooks.md` referencing plugin API (optional; can defer if size limit critical).
        Requirements: 8 (partial), 12

## 9. Quality Gate

-   [ ] Run vitest; ensure new test passes.
-   [ ] Lint/typecheck.
-   [ ] Confirm no size bloat (line count quick check).
        Requirements: 12

## 10. Follow-ups (deferred, not in scope)

-   Streaming injection.
-   Batch operations.
-   Outgoing filter chain integration.
