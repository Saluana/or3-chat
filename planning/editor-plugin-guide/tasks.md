# Editor Extensibility Tasks

artifact_id: a1bdfb47-8c54-4d1a-8f6c-6a5a1b0b412e

## 1. Registries and Public Types (existing)

-   [x] 1.1 Public interfaces `EditorToolbarButton`, `EditorNode`, `EditorMark` exist in composables (Requirements: 2, 3, 8, 10)
-   [x] 1.2 HMR-safe registries using globalThis Maps exist in `useEditorToolbar.ts` and `useEditorNodes.ts` (Requirements: 4, 5)
-   [x] 1.3 Default `order=200` and ascending sort implemented (Requirements: 6)
-   [x] 1.4 Register/unregister/list functions with dev overwrite warnings implemented (Requirements: 1, 2, 3, 4, 8)
-   [x] 1.5 listRegistered\*Ids helpers implemented (Requirements: 8)

## 2. Reactive Toolbar API

-   [x] 2.1 `useEditorToolbarButtons(editorRef)` implemented; returns computed array (Requirements: 1, 5)
-   [ ] 2.2 Add defensive try/catch around `visible` and ensure safe fallback (Requirements: 11)
-   [ ] 2.3 Optional enhancement: sort stability on ties by id (low priority) (Requirements: 6)

## 3. DocumentEditor Integration

-   [x] 3.1 `DocumentEditor.vue` collects nodes and marks via `listEditorNodes()`/`listEditorMarks()` (Requirements: 2, 3)
-   [ ] 3.2 Add defensive try/catch around extension assembly; log and skip failing extension (Requirements: 2, 3, 11)
-   [ ] 3.3 Emit hooks after create and onUpdate (Requirements: 7)

## 4. Hooks

-   [ ] 4.1 Ensure `useHooks()` provides action API; add typings if needed (Requirements: 7)
-   [ ] 4.2 Emit `editor.created:action:after` with `{ editor }` (Requirements: 7)
-   [ ] 4.3 Emit `editor.updated:action:after` with `{ editor }` (minimal payload) (Requirements: 7)

## 5. SSR/Client Safety

-   [ ] 5.1 Guard registry init paths if any SSR execution path is detected; otherwise document `.client.ts` usage (Requirements: 9)
-   [x] 5.2 Docs already instruct usage under `app/plugins/*.client.ts` (Requirements: 9, 2)

## 6. Example Plugins

-   [x] 6.1 Example: mark + button (highlight) in guide; ensure code sample compiles if copied (Requirements: 1, 3)
-   [x] 6.2 Example: custom node (callout) in guide; ensure code sample compiles if copied (Requirements: 2)
-   [ ] 6.3 Add a small example showing lifecycle hook usage (Requirements: 7)

## 7. Testing

-   [x] 7.1 Unit: basic registration/unregistration/dedup (editorToolbar.test.ts) (Requirements: 4)
-   [ ] 7.2 Unit: ordering tie behavior and stability (Requirements: 6)
-   [ ] 7.3 Unit: `useEditorToolbarButtons` visible error shielding (Requirements: 11)
-   [ ] 7.4 Integration: Editor creates with plugin nodes/marks; commands operate (Requirements: 2, 3)
-   [ ] 7.5 Integration: Toolbar renders and triggers `onClick` (Requirements: 1)
-   [ ] 7.6 Performance: measure editor creation with 0/10/30 plugin extensions (Requirements: NFR-1)

## 8. Documentation

-   [ ] 8.1 Keep `planning/editor-plugin-guide/EDITOR_EXTENSIBILITY_GUIDE.md` aligned; add API Location references (Requirements: 2)
-   [ ] 8.2 Add troubleshooting notes for duplicate ids, SSR, and icon names (Requirements: 8, 9)

## 9. Monitoring and Logging

-   [ ] 9.1 Add console warnings for duplicate id replacement and invalid payloads (dev only) (Requirements: 4, 8, 5)
-   [ ] 9.2 Ensure extension init failures log once and continue (Requirements: 2, 3, 11)

## 10. Backward Compatibility

-   [ ] 10.1 Verify behavior with zero plugins matches current editor (Requirements: 10)
-   [ ] 10.2 Verify removing/replacing plugins via HMR updates toolbar and extensions without reload (Requirements: 4, 10)
