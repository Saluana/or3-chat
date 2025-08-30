# Chat Simplification & Performance Tasks

Source: Review of current chat stack (`ChatInputDropper.vue`, `ChatContainer.vue`, `ChatPageShell.vue`, `useAi.ts`, `openrouterStream.ts`, plus related composables) – goal is to delete / replace code without breaking functionality.

Legend:

-   P#: Priority (1 = highest impact / lowest risk combo to start)
-   Est ΔLOC: Rough net lines removed (negative means addition) – guidance only
-   Risk: L (low), M (medium), H (high) – based on possible regressions

---

## Task List

-   [x] P1 Remove unused `useChatSend` abstraction

    -   Files: `app/components/chat/ChatContainer.vue` (import line ~97, usage lines ~410, ~439–447), `app/composables/useChatSend.ts` (entire file)
    -   Actions:
        -   Delete `useChatSend.ts`
        -   Remove import, instance, and `chatSend.send` call; rely solely on `useChat().sendMessage`
    -   Est ΔLOC: -90
    -   Risk: L (feature already redundant)
    -   Acceptance: Sending still works; no unresolved imports; no console errors referencing `useChatSend`.

-   [ ] P1 Remove per-message `console.log` in mapping

    -   File: `ChatContainer.vue` (message mapping line ~249)
    -   Est ΔLOC: -1
    -   Risk: L
    -   Acceptance: No log spam when viewing chat; message rendering unchanged.

-   [ ] P2 Integrate streaming tail directly into `useChat` (eliminate double buffering hooks)

    -   Files: `ChatContainer.vue` (tail logic lines ~300–372 & related watchers), `useTailStream.ts`, `useAi.ts` (stream loop lines ~154–275)
    -   Actions:
        -   Add reactive refs (`streamDisplayText`, `streamReasoning`, `streamId`, `streamActive`) to `useChat`
        -   Emit updates directly instead of via `hooks.doAction` for delta & reasoning (or keep hook for external plugins but still expose refs)
        -   Simplify `ChatContainer` to render tail from `chat` composable props (remove `useTailStream` & associated watchers)
        -   If `useTailStream` not reused elsewhere, delete file
    -   Est ΔLOC: -120 (after +30 added to `useChat`)
    -   Risk: M (must preserve hook consumers if any)
    -   Acceptance: Streaming UI unchanged (manual test); tail unmount/reset on thread switch still works.

-   [ ] P2 Merge duplicate history loads in `sendMessage`

    -   File: `useAi.ts` lines ~104–108 and ~201–205
    -   Action: Keep first `ensureThreadHistoryLoaded` call only (or guard second behind condition if history length changed)
    -   Est ΔLOC: -10
    -   Risk: L/M (concurrency edge very unlikely)
    -   Acceptance: Assistant still sees prior context including images; no regression in first reply.

-   [ ] P2 Unify attachment fields (`images` vs `attachments` / `uploadedImages`)

    -   Files: `ChatInputDropper.vue` (lines ~456–463, send payload lines ~694–695, template references for `uploadedImages`), `ChatContainer.vue` (onSend lines ~420–451)
    -   Actions:
        -   Remove `uploadedImages` computed alias
        -   Emit only `attachments`
        -   Update `onSend` to read `attachments`
        -   Adjust template loops (`uploadedImages` -> `attachments` or filtered variants)
    -   Est ΔLOC: -25 to -35
    -   Risk: L
    -   Acceptance: Attachments still display & send; no duplicate props in payload.

-   [ ] P3 Consolidate delta/content/image parsing loops in `openRouterStream`

    -   File: `openrouterStream.ts` lines ~54–108, 118–155, 162–196
    -   Action: Single pass over `delta.content` & `delta.images`, collect text + emit images; unify final image extraction
    -   Est ΔLOC: -40
    -   Risk: M (need to keep all provider cases: text, image_url, media, inline_data)
    -   Acceptance: All previous image & text streaming scenarios still appear; add quick test harness if possible.

-   [ ] P3 Adaptive persistence throttling during stream

    -   File: `useAi.ts` lines ~238–270 (timed persist) & image block ~210–236
    -   Actions:
        -   Track char count since last persist; persist if (chars >= 400) OR (>=500ms) OR (image added) OR (complete)
        -   Remove fixed 100ms writes (except fallback max interval)
    -   Est ΔLOC: ~0 (refactor) but reduces writes
    -   Risk: M (ensure reasoning text & images not lost on abort)
    -   Acceptance: IndexedDB writes reduced (log counts during test); final message & images persisted.

-   [ ] P3 Lazy-load TipTap editor on first focus/click

    -   File: `ChatInputDropper.vue` lines ~124–173 (init block)
    -   Actions:
        -   Render a simple contenteditable/textarea placeholder initially
        -   On focus, dynamic `import('@tiptap/vue-3')` & hydrate existing text
        -   Guard repeated loads
    -   Est ΔLOC: +15 (but bundle size & startup perf improvement)
    -   Risk: M (SSR hydration differences)
    -   Acceptance: Initial load lighter; focusing input loads editor transparently.

-   [ ] P4 Simplify drag overlay logic (counter instead of geometry)

    -   File: `ChatInputDropper.vue` lines ~651–666 / 626–650
    -   Actions:
        -   Add `dragDepth` ref; increment on dragenter, decrement on dragleave; show overlay when >0
        -   Remove `getBoundingClientRect` checks
    -   Est ΔLOC: -10
    -   Risk: L
    -   Acceptance: Overlay appears only while draggable items over component; no flicker leaving child elements.

-   [ ] P4 Remove unused `editorIsEmpty` & dead watchers / empty catch blocks

    -   File: `ChatInputDropper.vue` lines ~448–452; multiple `catch {}` / `catch { /* noop */ }` across files (search & prune where safe)
    -   Action: Delete computed if not referenced; collapse silent catches to concise comments only where truly intentional
    -   Est ΔLOC: -15
    -   Risk: L
    -   Acceptance: Build passes; no runtime references to removed symbol.

-   [ ] P4 (Optional) Centralize model persistence logic
    -   Files: `ChatInputDropper.vue` lines ~414–424 & any future model selectors
    -   Action: Extract composable `usePersistedModelSelection(key = 'last_selected_model')`
    -   Est ΔLOC: ~0 (move), improves reuse
    -   Risk: L
    -   Acceptance: Model selection still restores after reload.

---

## Suggested Implementation Order

1. Remove `useChatSend` + logging (quick wins, very low risk)
2. Unify attachments & remove alias
3. Integrate tail streaming into `useChat` (largest simplification) – run manual stream tests
4. Consolidate delta parsing & adaptive persistence
5. Remaining perf cleanups (lazy TipTap, drag logic, duplicate history call)
6. Optional refinements (editorIsEmpty removal, model persistence composable)

## Validation Checklist (after core refactors)

-   Smoke test: send text-only, image attachments, large pasted text block, reasoning model.
-   Abort mid-stream: partial assistant message retained, no tail ghosting.
-   Retry flow still works.
-   Multi-pane: switching panes resets stream state; no cross-thread tail leakage.
-   IndexedDB profiling: fewer writes (<50% of previous on long responses).
-   Cold load bundle diff: main chunk size reduced (after lazy TipTap) – verify via build stats if available.

---

## Notes

-   Keep hook events for external plugins if in use; otherwise deprecate after tail integration.
-   Before deleting `useTailStream.ts`, grep for other imports to avoid breaking reuse.
-   Add minimal unit/integration tests for streaming generator changes if test harness available.
