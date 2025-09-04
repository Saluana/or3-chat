# Unified Streaming Core Refactor - Requirements

Artifact ID: 5c2f5d2c-0f6e-4847-a9b7-609946d2daaa

## 1. Introduction

The goal is to eliminate duplicate streaming logic spread across `useTailStream.ts`, ad‑hoc accumulators in `useAi.ts` (a.k.a. `useChat`), and UI tail / handoff logic in `ChatContainer.vue`. We will consolidate into a single minimal streaming state manager embedded in (or imported by) `useChat`. The refactor must preserve existing user‑visible behavior (progressive token display, reasoning channel rendering, scroll continuity) while reducing code size, watchers, and buffering complexity.

Scope includes: streaming accumulation, reasoning channel handling, finalization semantics, UI exposure, removal of obsolete composable (`useTailStream.ts`), and simplification of tail / handoff conditional rendering in `ChatContainer.vue`. Non‑scope: broader send pipeline modularization (handled separately), attachment logic, viewport virtualization strategy, PKCE auth, or message normalization beyond what is required for streaming state.

## 2. User Roles

-   Developer (primary): Needs simpler, single source of truth for streaming state to accelerate future maintenance.
-   End User: Expects real‑time token streaming with smooth UI updates, no regressions in perceived latency, correctness of final message text and reasoning content.

## 3. Functional Requirements (User Stories & Acceptance Criteria)

### R1. Single Streaming State Object

As a developer, I want a single reactive streaming state object so that I no longer maintain parallel buffering logic.
Acceptance Criteria:

-   WHEN the assistant reply streaming begins THEN a reactive object exists with keys: `text`, `reasoningText`, `isActive`, `error`, `finalized`.
-   WHEN tokens arrive THEN `text` (or `reasoningText` for reasoning channel) SHALL update progressively.
-   WHEN finalization occurs THEN `finalized` SHALL be true and `isActive` false.
-   IF an error occurs mid-stream THEN `error` SHALL contain an Error (or message) and `isActive` becomes false.

### R2. Append API

As a developer, I want a unified `append(delta, { kind })` API so that I can eliminate manual string concatenations in multiple places.
Acceptance Criteria:

-   GIVEN streaming in progress WHEN `append('abc', { kind: 'text' })` is called THEN characters appear in `state.text` buffer after the next animation frame.
-   GIVEN streaming in progress WHEN multiple `append` calls occur within a frame THEN they SHALL batch into a single reactive update (≤1 flush per animation frame).
-   GIVEN `kind: 'reasoning'` THEN buffer targets `reasoningText`.
-   WHEN streaming has finalized THEN subsequent `append` calls SHALL be ignored (no mutation) and logged in dev mode.

### R3. Micro-batching via requestAnimationFrame

As a user, I want smooth token rendering without lag so that reading experience is fluid.
Acceptance Criteria:

-   WHEN ≥2 token deltas arrive within <16ms THEN only one DOM reactive commit SHALL occur (verified via test instrumentation counting updates).
-   Average flush latency SHALL remain ≤ one animation frame (≈16ms) under normal token cadence (assume ≤40 tokens/sec) in test harness.

### R4. Finalization Semantics

As a developer, I need deterministic final flush semantics so that no trailing token is lost.
Acceptance Criteria:

-   WHEN the upstream stream completes THEN `finalize()` SHALL flush any pending buffered chunks before setting `finalized=true`.
-   WHEN `finalize()` is called multiple times THEN only the first invocation SHALL have effect (idempotent).
-   IF `abortController.abort()` is triggered mid-stream THEN `finalize()` SHALL still flush buffered tokens and mark inactive with `finalized=true` AND `error` unset (unless an error previously set).

### R5. Error Handling

As a developer, I need clear error propagation to UI.
Acceptance Criteria:

-   WHEN a streaming error is thrown THEN `error` is populated and `isActive=false` and `finalized=true`.
-   WHEN an error occurs THEN pending buffered tokens SHALL still flush prior to state deactivation.

### R6. Reasoning Channel Support

As a developer, I want optional reasoning tokens handled in the same accumulator to reduce branching.
Acceptance Criteria:

-   WHEN reasoning deltas arrive THEN they update `reasoningText` via the same `append` API.
-   IF no reasoning tokens arrive THEN `reasoningText` remains an empty string and UI renders no reasoning section.

### R7. Legacy `useTailStream` Removal

As a maintainer, I want the old composable fully removed to reduce dead code.
Acceptance Criteria:

-   File `useTailStream.ts` SHALL be deleted.
-   All imports referencing it SHALL be removed or replaced.
-   No references to legacy tail stream timers remain in codebase (grep for `tailStream`, `pushInterval`, `flushInterval`).

### R8. UI Simplification in `ChatContainer.vue`

As a developer, I want tail/handoff logic reduced to a single computed for in-progress assistant message.
Acceptance Criteria:

-   All separate watchers previously orchestrating tail gating SHALL be removed or consolidated (≥80% reduction relative to baseline count for this feature slice).
-   A single computed decides whether to render a streaming placeholder vs finalized assistant message.
-   Scroll behavior (auto-scroll when at bottom) SHALL remain unchanged for end-user (verified via integration test comparing scroll position deltas pre/post).

### R9. Regression Test: Output Equivalence

As a maintainer, I need confidence the new accumulator yields identical final output text.
Acceptance Criteria:

-   GIVEN a deterministic mock stream of tokens THEN final concatenated `text` SHALL exactly equal baseline legacy implementation output captured before refactor.
-   Test SHALL cover: only text tokens, interleaved reasoning + text tokens, and an aborted stream.

### R10. Performance Guardrail

As a maintainer, I want to ensure no performance regression.
Acceptance Criteria:

-   A performance test harness SHALL record number of reactive updates during a 200-token simulated stream; new implementation SHALL produce ≤20 reactive commits (target batching ratio ≥10:1) and not exceed legacy count.

### R11. Type Safety & API Surface

As a developer, I want strong typing for the streaming state and accumulator functions.
Acceptance Criteria:

-   A TypeScript interface `StreamingState` is defined with exact field types.
-   Public API exported: `createStreamAccumulator()` returning `{ state, append, finalize, reset }`.
-   No other internal implementation details leak.

### R12. Backwards Compatibility Hooks

As a plugin author (future), I need minimal disruption to existing hook order.
Acceptance Criteria:

-   Hook invocation order for send+stream path SHALL remain unchanged except removal of tail flush timers (verified via snapshot test of hook names sequence).

## 4. Non-Functional Requirements

-   Simplicity: Core accumulator implementation ≤60 LOC (excluding tests & types).
-   Determinism: No reliance on setInterval / setTimeout for batching (only rAF + fallback for test environment using `setTimeout(0)` if rAF unavailable).
-   Test Coverage: ≥90% statement coverage for accumulator module.
-   No additional runtime dependencies introduced.
-   Code style consistent with existing project ESLint / TS config.

## 5. Constraints & Assumptions

-   Assumes Vue 3 reactivity (likely `ref`, `reactive`, `shallowRef`).
-   Assumes existing send pipeline can be lightly edited to replace legacy writes with `append` calls.
-   Reasoning tokens are distinctly labeled upstream (e.g., meta or channel flag) – a mapping layer will classify them before calling `append`.
-   Virtualization boundary logic will be simplified later; only minimal changes now to remove tail handoff watchers.

## 6. Out of Scope

-   Full message shape normalization (handled in separate refactor).
-   Attachment lifecycle or image hash logic.
-   Scroll virtualization redesign.

## 7. Dependencies

-   Current `useAi.ts` streaming loop.
-   Existing hooks that might rely on timing; need snapshot before refactor.

## 8. Risks & Mitigations

| Risk                                  | Impact                       | Mitigation                                                   |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| Missed final token flush              | Truncated assistant response | Idempotent `finalize()` flush pending buffer first           |
| Increased perceived latency           | Worse UX                     | rAF batching only (max 1 frame); test ensures flush ≤16ms    |
| Hook order drift                      | Plugin regressions           | Snapshot test of hook order pre-change                       |
| Race between finalize and last append | Duplicate or lost chars      | Internal queue drain inside finalize before marking inactive |
| Aborted streams mis-labeled as errors | Confusing UI                 | Distinguish abort vs error (no `error` set on abort)         |

## 9. Acceptance & Completion Checklist

-   [ ] All functional requirements R1–R12 satisfied.
-   [ ] Legacy file removed and imports updated.
-   [ ] Tests (unit + integration + performance harness) added and passing.
-   [ ] Lines of code reduced within estimated savings range (informational metric recorded).
-   [ ] Documentation in `docs/` or code comments updated referencing new API.
-   [ ] No lint / type errors introduced.

## 10. Glossary

-   Accumulator: The in-memory structure handling token buffering & flush.
-   Finalization: Transition point where stream ends (normal completion or abort/error) and pending tokens flush.
-   Reasoning Channel: Optional secondary textual stream separate from main answer.
