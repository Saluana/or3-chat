# Unified Streaming Core Refactor - Task Plan

Artifact ID: 0a6a20ba-3382-4e73-8bb4-6b33c37f93ef

## Legend

Req Mapping: R# refers to requirements in `requirements.md`.

## 1. Accumulator Module Implementation

-   [x] 1.1 Create file `composables/useStreamAccumulator.ts` exporting `createStreamAccumulator` (Req: R1,R2,R3,R4,R5,R6,R11)
    -   [x] 1.1.1 Define `StreamingState`, `AppendKind`, API interface (R11)
    -   [x] 1.1.2 Implement batching via rAF with fallback (R3)
    -   [x] 1.1.3 Implement `append` staging logic (R2,R6)
    -   [x] 1.1.4 Implement `flush()` internal + version increment (R1,R3)
    -   [x] 1.1.5 Implement `finalize()` (success/error/abort) idempotent (R4,R5)
    -   [x] 1.1.6 Implement `reset()` (R11)
    -   [x] 1.1.7 Dev warnings for misuse (append after finalize) (R4,R5)

## 2. Unit Tests for Accumulator

-   [x] 2.1 Add test file `app/composables/__tests__/streamAccumulator.test.ts` (R1-R6,R11)
    -   [x] 2.1.1 Test batching (multiple appends single frame) (R3)
    -   [x] 2.1.2 Test reasoning vs main channels (R6)
    -   [x] 2.1.3 Test finalize flushes pending tokens (R4)
    -   [x] 2.1.4 Test finalize idempotent (R4)
    -   [x] 2.1.5 Test error finalize sets error (R5)
    -   [x] 2.1.6 Test abort finalize no error (R5)
    -   [x] 2.1.7 Test append after finalize ignored (R4)
    -   [x] 2.1.8 Test reset reactivates state (R11)

## 3. Hook Order Snapshot (Pre-change)

-   [x] 3.1 Add instrumentation test capturing current hook invocation order (R12)
    -   [x] 3.1.1 Record baseline array in snapshot file
    -   [x] 3.1.2 Commit snapshot before integrating accumulator

## 4. Dual-Write Integration (Feature Flag Phase)

-   [x] 4.1 Import accumulator into `useAi.ts` (R1,R2)
    -   [x] 4.1.1 Add `const USE_NEW_STREAM = true` (temporary flag) (R12 safeguard)
    -   [x] 4.1.2 Replace manual concatenations with `append` while still updating legacy fields (`streamDisplayText`, etc.) (R9)
    -   [x] 4.1.3 Call `finalize()` on completion, error, abort (R4,R5)
    -   [x] 4.1.4 Expose `streamState` to components (R1)

## 5. Regression Snapshot Tests

-   [x] 5.1 Simulated pure text stream parity test (R9)
-   [x] 5.2 Interleaved reasoning + text parity test (R6,R9)
-   [x] 5.3 Abort mid-stream parity test (R4,R9)

## 6. Performance Test Harness

-   [x] 6.1 Add test measuring version increments for 200-token synthetic burst (R10)
    -   [x] 6.1.1 Assert ≤20 version increments

## 7. Remove Legacy Tail Stream

-   [ ] 7.1 Delete `useTailStream.ts` (R7)
-   [ ] 7.2 Remove all imports referencing it (R7)
-   [ ] 7.3 Delete legacy constants (R7)
-   [ ] 7.4 Remove dual-write paths inside `useAi.ts` (R7,R1)
-   [ ] 7.5 Drop feature flag (R7)

## 8. Simplify `ChatContainer.vue`

-   [ ] 8.1 Remove tail/handoff watchers (R8)
-   [ ] 8.2 Implement single `streamingMessage` computed (R8)
-   [ ] 8.3 Update template to render placeholder based on `streamState.isActive` (R8)
-   [ ] 8.4 Consolidate auto-scroll effect to watch `messages.length` and `streamState.version` (R8,R1)
-   [ ] 8.5 Ensure reasoning text displayed if present (R6,R8)

## 9. Scroll Behavior Test

-   [ ] 9.1 Integration test verifying no auto-scroll when user scrolled up (R8)
-   [ ] 9.2 Integration test verifying auto-scroll when at bottom (R8)

## 10. Cleanup & Validation

-   [ ] 10.1 Grep for `tailStream` / legacy constants returns nothing (R7)
-   [ ] 10.2 Grep for `streamDisplayText` removed if fully replaced (unless kept for normalization refactor) (R1)
-   [ ] 10.3 Lint & type check pass (R11)
-   [ ] 10.4 Coverage report ≥90% for accumulator (R11)
-   [ ] 10.5 Update documentation (`docs/` add short section) (R1)
-   [ ] 10.6 Record LOC diff (informational) (R10)

## 11. Risk Mitigation Tasks

-   [ ] 11.1 Add dev warning if `append` called with empty string repeatedly (could indicate upstream bug) (R5)
-   [ ] 11.2 Add `ensureNotFinalized()` inline helper for clarity (R4)

## 12. Out-of-Scope Deferred Notes

-   [ ] 12.1 Add TODO comment referencing upcoming message normalization to avoid duplication (Informational)

## 13. Acceptance Checklist Summary

| Req | Covered By Tasks |
| --- | ---------------- |
| R1  | 1,4,7,8          |
| R2  | 1,4              |
| R3  | 1,2,6            |
| R4  | 1,2,4,5          |
| R5  | 1,2,4            |
| R6  | 1,2,5,8          |
| R7  | 7,10             |
| R8  | 8,9              |
| R9  | 5                |
| R10 | 6,10             |
| R11 | 1,2,10           |
| R12 | 3,4              |

## 14. Dependencies & Order

Recommended execution order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

## 15. Completion Definition

Refactor complete when tasks 1–10 are done and all requirement mappings pass associated tests; tasks 11–12 optional but recommended.
