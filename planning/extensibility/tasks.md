artifact_id: 1d0a3f2a-0e3b-4b0e-8d0b-d0eebe9f63a9

# Extensibility & Plugin Surface Unification — Tasks

Note: All tasks follow existing patterns (global registries via globalThis, reactive projections, default order 200, HMR safety, dev warnings on overwrite). Keep scope minimal and performance-focused.

## 1. Publish Hook Map and Types (Req: 1, 10, 11)

-   [ ] 1.1 Create `app/utils/hook-keys.ts` exporting:
    -   [ ] `HookKey` union covering: ui.chat.message:filter:outgoing/incoming; ai.chat.send:action:before/after; ai.chat.stream:action:delta/reasoning/complete/error; ui.pane.msg:action:sent/received; db._ existing hooks; files._; threads._; documents._
    -   [ ] Payload interfaces: `AiSendBefore`, `AiStreamDeltaCtx`, `AiStreamReasoningCtx`, `AiStreamCompleteCtx`, `AiStreamErrorCtx`, etc.
    -   [ ] Optional helper: `typedOn(hooks).on<K extends HookKey>(key: K, fn, opts)` for better IDE help without changing engine.
-   [ ] 1.2 Add docs in `docs/core-hook-map.md` summarizing names, phases, and veto semantics.

## 2. Message Lifecycle Hooks Completion (Req: 2, 11)

-   [ ] 2.1 In `app/composables/useAi.ts`:
    -   [ ] Add early veto: respect `ui.chat.message:filter:outgoing` returning `false` or empty string → skip append + network; toast and return.
    -   [ ] Ensure `ai.chat.send:action:before` is called (already present) and `ai.chat.send:action:after` covers both success and abort/error (present; confirm payloads align with types).
    -   [ ] Add `ai.chat.stream:action:complete` after final persist, with totals and reasoning length; add `ai.chat.stream:action:error` in catch/abort path.
    -   [ ] Verify existing `ai.chat.stream:action:delta` and `:reasoning` payloads contain chunkIndex/lengths per design.
-   [ ] 2.2 Update unit tests to cover veto, success path, abort path.

## 3. Editor Registries (Req: 3, 10, 11)

-   [ ] 3.1 Add `app/composables/ui-extensions/editor/useEditorToolbar.ts` with APIs:
    -   [ ] `registerEditorToolbarButton`, `unregisterEditorToolbarButton`, `useEditorToolbarButtons(editorRef)` (ordered, visible filter, isActive).
-   [ ] 3.2 Add `.../editor/useEditorSlashCommands.ts` with `registerEditorSlashCommand`, `useEditorSlashCommands(queryRef)`.
-   [ ] 3.3 Add `.../editor/useEditorNodes.ts` with `registerEditorNode`, `registerEditorMark`, `listEditorNodes`, `listEditorMarks`.
-   [ ] 3.4 Wire editor screens (Document editor and any chat composer TipTap) to consume toolbar/commands/nodes lists.
-   [ ] 3.5 Example plugin registering one toolbar button and one slash command.

## 4. UI Chrome Registries (Req: 4, 10)

-   [ ] 4.1 Add `.../chrome/useSidebarSections.ts` (sections + optional footer actions) and integrate into Sidebar component slots.
-   [ ] 4.2 Add `.../chrome/useHeaderActions.ts` and render in header bar (icon button group).
-   [ ] 4.3 Add `.../chrome/useComposerActions.ts` and mount near input send area.

## 5. Thread/Document History Registries Completion (Req: 5)

-   [ ] 5.1 Confirm `useThreadHistoryActions.ts` and `useDocumentHistoryActions.ts` export lists and are used in their respective views; if WIP, wire them and add tests.
-   [ ] 5.2 Add README snippets in each composable with order and ID collision guidance.

## 6. Document Hooks (Req: 6, 10)

-   [ ] 6.1 In `app/db/documents.ts` ensure filters/actions are documented; add optional `db.documents.title:filter` called from `normalizeTitle` path with default pass-through.
-   [ ] 6.2 Write tests that assert `createDocument/updateDocument` call hooks in order and allow title/content transform.

## 7. File Pipeline Hooks (Req: 7, 11)

-   [ ] 7.1 In `app/db/files.ts` document existing create hooks; add optional `files.attach:filter:input` shim in the chat send path when attachments are included (pre `createOrRefFile`).
-   [ ] 7.2 Add unit tests: reject file via filter; accept and ensure DB writes.

## 8. Capability Manifest (Req: 8)

-   [ ] 8.1 Extend `DashboardPlugin` type in `useDashboardPlugins.ts` with `capabilities?: string[]`.
-   [ ] 8.2 Add `hasCapability(pluginId, cap)` helper and export.
-   [ ] 8.3 Wire minimal guards where plugin-originated actions invoke sensitive operations (pane/plugin context available). When missing, show toast and no-op.
-   [ ] 8.4 Add a small UI in dashboard plugin detail to list capabilities.

## 9. Hook Inspector Dashboard Page (Req: 9, 10, 11)

-   [ ] 9.1 Register `devtools` dashboard plugin with page `hook-inspector`.
-   [ ] 9.2 Implement component to read `useHooks()._diagnostics` and render:
    -   [ ] Totals (actions/filters), per-hook stats (avg/p95/max), errors.
    -   [ ] Button: Clear timings.
    -   [ ] Auto-refresh toggle.
-   [ ] 9.3 Link to `docs/core-hook-map.md`.

## 10. Documentation and Examples (Req: 10)

-   [ ] 10.1 Add `docs/core-hook-map.md` and update `docs/hooks.md` with new sections.
-   [ ] 10.2 Add example plugin files under `app/plugins/examples/` demonstrating message veto, editor toolbar button, slash command, header action, file filter.

## 11. Testing and Quality Gates (Req: 11)

-   [ ] 11.1 Unit tests for new registries.
-   [ ] 11.2 Integration tests for chat send/stream and document update.
-   [ ] 11.3 Lint/typecheck pipeline; ensure no new TS errors.
-   [ ] 11.4 Manual smoke: start app, verify actions and Hook Inspector page.

## 12. Follow-ups (deferred)

-   [ ] 12.1 Typed wrapper around `hooks.applyFilters` and `hooks.doAction` without changing engine signature (pure helper).
-   [ ] 12.2 Optional per-plugin capability prompts (ask user to grant on first use).
