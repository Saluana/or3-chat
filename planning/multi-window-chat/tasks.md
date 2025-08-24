# Multi-Window Chat Tasks

artifact_id: 2f4d9bb4-a16d-4ad6-8ec5-4a0fbbe1bd5f

(Keep to only 3 top-level tasks per instruction; subtasks kept minimal.)

## 1. Refactor ChatPageShell state to support multiple panes

-   [ ] 1.1 Introduce `PaneState` interface and `panes` ref array (init with one pane)
-   [ ] 1.2 Replace single `threadId` / `messageHistory` with pane-specific fields
-   [ ] 1.3 Extract existing `loadMessages` logic into `loadMessagesFor(threadId)` returning array
-   [ ] 1.4 Implement `setPaneThread(index, threadId)` updating pane & loading messages
-   [ ] 1.5 Add `activePaneIndex` ref + helper `setActive(i)`
-   [ ] 1.6 Remove now-unused single-pane refs

Requirements: R1, R4, R5

## 2. UI & Interaction additions

-   [ ] 2.1 Replace single ChatContainer with v-for over panes
-   [ ] 2.2 Add pane wrapper div (flex child) with active styling (primary border) (R3)
-   [ ] 2.3 Implement New Window button -> `addPane()` (disable at 3) (R1)
-   [ ] 2.4 Add Close button per pane when panes.length > 1 (R2)
-   [ ] 2.5 Implement keyboard navigation (ArrowLeft/ArrowRight) & focus via tabindex (R6)
-   [ ] 2.6 Hook ChatContainer emitted thread-created event per index
-   [ ] 2.7 Update sidebar handlers to target active pane only (R4)

Requirements: R1, R2, R3, R4, R6

## 3. Polish & Validation

-   [ ] 3.1 Guard against >3 panes (R1)
-   [ ] 3.2 Ensure closing active pane sets new active logically (R2)
-   [ ] 3.3 Visual QA: borders, disabled New Window state, hover for close
-   [ ] 3.4 Light manual test matrix execution (Section 11 of design)
-   [ ] 3.5 Code cleanup & comments (simplicity mandate)

Requirements: R1, R2, R3, R4, R5, R6

## Completion Criteria

-   All acceptance criteria R1-R6 satisfied.
-   No console errors on typical interactions.
-   Changes confined to `ChatPageShell.vue` (plus minor type additions inline).
