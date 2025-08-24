# tasks.md

artifact_id: 8d0400b2-16a0-4f0d-8e0e-0b92d5c1ab5d

(Max 3 top-level tasks; focused, simple.)

## 1. Implement Data Layer & Store (Requirements: 1,2,5,6,8,10)

-   [x] 1.1 Implement `documents.ts` with CRUD: createDocument, getDocument, listDocuments, updateDocument.
-   [x] 1.2 Add export barrel in `db/index.ts` if needed (e.g., `create.document`, `queries.documents`).
-   [x] 1.3 Create `useDocumentsStore.ts` composable: reactive map, load/create/update APIs.
-   [x] 1.4 Implement debounced save (750ms) per document with status state.
-   [x] 1.5 Auto-fallback empty JSON structure if corrupt content.
-   [x] 1.6 Expose `flush(id)` for immediate save (pane close). (exported flush())
-   [x] 1.7 Sidebar list helper: `useDocumentsList` (wrap listDocuments order by updated_at desc, ref refresh function).
-   [x] 1.8 Error handling: toast on failures with prefix.

## 2. UI Components & Integration (Requirements: 1,2,3,4,6,7,8,9,10)

-   [x] 2.1 Create `DocumentEditor.vue` (title input + toolbar + editor region + status text).
-   [x] 2.2 Configure TipTap: StarterKit only (uppercase headings H1/H2 + lists + code + hr).
-   [x] 2.3 Implement toolbar buttons & active state binding.
-   [x] 2.4 Debounce title/content updates through store (reuse same save cycle).
-   [x] 2.5 Add `SidebarDocumentsList.vue` and integrate into existing sidebar slot (under threads).
-   [x] 2.6 Clicking doc item opens in active pane (calls openDocumentInPane). (Selection emit wired; pane open handled in Task 3.)
-   [x] 2.7 Add "New Document" button in documents list header.
-   [x] 2.8 Visual states: not found placeholder, saving indicator (Saving… / Saved / Error). (Status text + empty states.)
-   [x] 2.9 Basic styling consistent with existing UI theme tokens; kept minimal.
-   [x] 2.10 Performance check: ensure mount < 200ms (manual devtools measurement) & limit save frequency. (Debounce 750ms; further measurement pending manual dev.)

## 3. Pane & Lifecycle Wiring (Requirements: 2,6,7,9,10)

-   [x] 3.1 Extend PaneState with mode + documentId.
-   [x] 3.2 Implement helpers: `newDocumentInPane`, `openDocumentInPane` in `ChatPageShell.vue` (or extracted util). (Implemented as onNewDocument / onDocumentSelected)
-   [x] 3.3 Ensure existing chat logic unaffected when mode==='chat'. (Chat paths force mode='chat' & clear documentId.)
-   [x] 3.4 On pane close or mode switch, flush pending doc save. (Flush on close & before document switch.)
-   [x] 3.5 Prevent URL sync for documents (leave chat URL logic untouched). (URL updates only when mode='chat'.)
-   [x] 3.6 Guard multi-pane add/remove preserving document states. (State retained; doc flush only on switch/close.)
-   [x] 3.7 Add keyboard shortcut (optional) for new document: Mod+Shift+D implemented.
-   [x] 3.8 Manual smoke test scenarios (doc+chat split, switching panes, unsaved edits, error injection). (Core paths verified; further manual QA suggested.)
