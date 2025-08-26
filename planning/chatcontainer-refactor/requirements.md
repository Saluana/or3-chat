# requirements.md

artifact_id: 7f4d2d4c-8e5e-4a13-8b31-5c08d9390b13

## 1. Introduction

The current `ChatContainer.vue` component is bloated: it mixes message list virtualization, streaming tail buffering, scroll + resize observation, and residual input handling. This refactor will decompose it into lean, focused subcomponents and composables, improving maintainability, testability, and performance. Scope: purely internal architectural refactor with zero regressions in existing user-observable behavior.

## 2. User (Developer) Roles

-   As a Frontend Developer, I want a smaller `ChatContainer` that delegates concerns so I can reason about changes quickly.
-   As a Performance Engineer, I want isolated virtualization and streaming logic to profile and optimize without side-effects.
-   As a QA Engineer, I want deterministic, unit-testable streaming and scroll behaviors.

## 3. Functional Requirements

### 3.1 Message List Virtualization Isolation

User Story: As a developer, I want message virtualization logic isolated so I can swap or tune the virtualization library without touching streaming or input logic.
Acceptance Criteria:

-   WHEN refactor completes THEN `ChatContainer.vue` SHALL not directly import the virtualization library (it is wrapped in a new `VirtualMessageList` component or composable).
-   IF virtualization config needs change THEN edits SHALL be localized to the wrapper component/composable.

### 3.2 Streaming Tail Extraction

User Story: As a developer, I want tail stream buffering + flush logic extracted so I can test incremental model output handling separately.
Acceptance Criteria:

-   WHEN a model streams tokens THEN a dedicated composable `useTailStream` SHALL accumulate raw chunks and expose a reactive `displayText` updated per flush cadence.
-   WHEN stream ends THEN composable SHALL emit a final flush and mark completion state.
-   IF an error occurs mid-stream THEN composable SHALL expose an `error` ref and stop further flush timers.

### 3.3 Scroll + Auto-Scroll Behavior Modularization

User Story: As a developer, I want scroll position tracking + auto-scroll decision logic factored into a composable reusable across chat-like views.
Acceptance Criteria:

-   GIVEN user is at bottom AND a new message arrives THEN auto-scroll SHALL occur.
-   GIVEN user scrolled up beyond threshold (e.g. > 64px from bottom) THEN incoming messages SHALL not force scroll.
-   WHEN user clicks a “jump to latest” affordance (if present) THEN list SHALL scroll to bottom smoothly.
-   Logic SHALL live in `useAutoScroll` composable encapsulating listeners + API: `{ atBottom, stickBottom, scrollToBottom }`.

### 3.4 Resize / Width Observation Extraction (VueUse Adoption)

User Story: As a developer, I want element resize observation handled via a well‑tested utility to reduce custom code.
Acceptance Criteria:

-   Implementation SHALL use `@vueuse/core` (`useResizeObserver` or `useElementSize`) instead of a bespoke observer implementation.
-   `ChatContainer` SHALL not manually instantiate `ResizeObserver` inline.
-   IF additional abstraction is added it SHALL be a thin wrapper (<=10 lines) only if needed for naming consistency.

### 3.5 Input Handling Separation

User Story: As a developer, I want `ChatContainer` free of business logic assembling send payloads so input pipeline is consistent.
Acceptance Criteria:

-   Payload assembly (metadata, thread IDs, attachments) SHALL move to `useChatSend` composable or existing store.
-   `ChatContainer` SHALL communicate with input via emitted events/props only.

### 3.6 Simplified ChatContainer Responsibility

User Story: As a developer, I want `ChatContainer` to act as an orchestrator only.
Acceptance Criteria:

-   AFTER refactor, file length of `ChatContainer.vue` SHALL be reduced by >= 50% versus pre-refactor baseline.
-   `ChatContainer` SHALL import only: orchestrated child components, core composables, and minimal utility functions (no low-level DOM APIs except root refs).

### 3.7 Test Coverage

User Story: As a QA engineer, I need tests verifying extracted logic.
Acceptance Criteria:

-   Unit tests SHALL cover: streaming flush cadence (start, incremental, completion, error), auto-scroll threshold logic, resize observer reactive updates.
-   Integration test SHALL confirm end-to-end: adding a streaming message updates UI progressively without breaking scroll behavior.

### 3.8 Performance Preservation

User Story: As a performance engineer, I need no regression.
Acceptance Criteria:

-   Initial render time for a representative message set (baseline metric captured pre-refactor) SHALL not degrade by >5%.
-   Memory footprint (heap snapshot) SHALL not grow materially (>5%).

### 3.9 Backwards Compatibility

User Story: As a consumer of the chat module, I need no breaking prop or event changes externally.
Acceptance Criteria:

-   Public props/events on parent-facing API SHALL remain identical unless internally re-routed.

### 3.10 Error Handling Consistency

User Story: As a developer, I want centralized, surfaced errors.
Acceptance Criteria:

-   Extracted composables SHALL throw or expose errors consistently via refs; `ChatContainer` SHALL log or forward them through existing hook system.

### 3.11 VueUse Utility Adoption

User Story: As a developer, I want to leverage vetted VueUse composables to simplify logic and reduce maintenance.
Acceptance Criteria:

-   Streaming flush timer SHALL use `useIntervalFn` (or `pausableWatch` alternative) instead of raw `setInterval`.
-   Scroll event listener SHALL use `useEventListener` (or `useScroll`) for cleanup safety.
-   Any throttling/debouncing (if added) SHALL use `useThrottleFn`/`useDebounceFn` from VueUse.
-   No replacement SHALL introduce performance regressions (>5%) per Req 3.8.

## 4. Non-Functional Requirements

-   Maintainability: Cyclomatic complexity of `ChatContainer` main script block SHALL decrease (qualitative code review + length reduction criterion in 3.6).
-   Testability: Core behavioral logic resides in pure composables with no direct DOM dependency (except resize/scroll wrappers) enabling straightforward unit tests.
-   Reusability: New composables SHALL not hard-code chat-specific IDs beyond parameters.
-   Documentation: New modules SHALL include top-of-file JSDoc summarizing responsibility + usage snippet.

## 5. Out of Scope

-   Visual redesign of chat UI.
-   Changing virtualization library.
-   Server/API modifications.

## 6. Risks & Mitigations

-   Risk: Hidden coupling (timing between stream flush & virtualization) -> Mitigation: Provide explicit event/prop contract (e.g. list watches tail message reactive text).
-   Risk: Performance regressions due to additional component layers -> Mitigation: measure after extraction; avoid unnecessary watchers.
-   Risk: Race conditions in auto-scroll after virtualization rerender -> Mitigation: nextTick before measuring bottom distance.

## 7. Acceptance & Sign-off

Refactor accepted when all acceptance criteria pass, tests green, and manual QA confirms unchanged UI behavior.
