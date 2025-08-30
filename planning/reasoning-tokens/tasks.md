# tasks.md

artifact_id: 5f9a4278-1c4b-4f4f-8d2a-9ac5b602e2cb

## Overview

Implementation plan aligned with updated requirements (R1–R5, NFR1–NFR7). All tasks unchecked initially.

## 1. Utilities & Capability Detection (R1, R4, NFR1, NFR2)

-   [x] 1.1 Implement `extractReasoning` util in `utils/models-service.ts` (or adjacent util file) per design.
-   [x] 1.2 Add truncation logic (>100k chars) with `[truncated]` suffix.
-   [x] 1.3 Export `modelSupportsReasoning(modelId)` helper with regex list.
-   [x] 1.4 Unit tests for util (string, details, empty, invalid, truncation).

## 2. Streaming Integration (R1, R3, R4, NFR2, NFR3, NFR6, NFR7)

-   [x] 2.1 In streaming handler, detect reasoning deltas; append to non-reactive `reasoningBuffer`.
-   [x] 2.2 Implement throttle flush (80–120ms) updating `reasoningContentRef` (shallowRef).
-   [x] 2.3 On final chunk call `extractReasoning` with final raw message; merge result into `message.data` before persistence.
-   [x] 2.4 Ensure absence of reasoning leaves message.data untouched.
-   [x] 2.5 Guard memory: stop appending after truncation applied.
-   [x] 2.6 Integration test (simulated stream) verifying persisted == final ref.

## 3. Reusable Component (R2, R3, R4, R5, NFR3, NFR4, NFR6)

-   [x] 3.1 Create `components/chat/ReasoningAccordion.vue` with props (`content`, `streaming`, `pending`).
-   [x] 3.2 Implement toggle button with `aria-expanded`, `aria-controls`.
-   [x] 3.3 Add placeholder state: pending + no content -> "Thinking…" + pulse indicator.
-   [x] 3.4 Style: minimal scoped CSS (toggle + box + pulse) reusing theme vars.
-   [x] 3.5 Component unit tests: placeholder visibility, toggle, long content scroll.

## 4. Chat Integration (R2, R3, R4, R5)

-   [x] 4.1 Inject `ReasoningAccordion` into tail streaming message component (identify file; pass streaming props).
-   [x] 4.2 Inject into `ChatMessage.vue` for finalized assistant messages.
-   [x] 4.3 Ensure no rendering for user messages or absent reasoning (unless pending in streaming state).
-   [x] 4.4 Preserve per-message expansion state (non-persistent ephemeral field on message object).

## 5. Performance & Stability (R3, NFR2, NFR3, NFR6, NFR7)

-   [x] 5.1 Verify throttle interval avoids >12 updates/sec (inspect flush count in test).
-   [x] 5.2 Measure bundle delta (build stats) ensure <1KB gzip increase (manual check / comment result).
-   [x] 5.3 Confirm zero layout shift via Lighthouse or simple DOM bounding box snapshot (manual acceptable).

<!-- NOTE: Streaming fix applied (reasoning ref created before push, flush on finalize). -->

## 6. Accessibility & QA (R2, R4, NFR4)

-   [x] 6.1 Accessibility audit: keyboard toggle, focus ring, aria attributes correct.
-   [x] 6.2 Screen reader quick check (VoiceOver) ensures labels announce states (manual note).

## 7. Documentation & Cleanup (All)

-   [x] 7.1 Add short section to `docs/` (e.g., `reasoning.md`) summarizing usage and integration.
-   [x] 7.2 Add code comments (util + component) referencing requirements IDs.
-   [x] 7.3 Lint & typecheck pass.
-   [x] 7.4 Add test entries to CI if needed.

## 8. Completion Gate

-   [x] 8.1 All functional tests green.
-   [x] 8.2 Manual end-to-end reasoning-capable model test: live streaming + final persistence verified after reload.
-   [x] 8.3 Sign off: requirements matrix checked.

## Requirement Mapping Summary

-   R1: 1.x, 2.3, 2.4
-   R2: 3.x, 4.x, 6.1
-   R3: 2.x, 4.3, 5.x
-   R4: 2.1–2.3, 3.3, 4.1, 5.1
-   R5: 3.x, 4.x
-   NFR1: 1.x (no schema changes)
-   NFR2: 1.1, 2.1–2.4, 5.1
-   NFR3: 3.1–3.5, 5.2
-   NFR4: 3.2, 6.1
-   NFR5: implicit (no task adds deps) verified 5.2
-   NFR6: 2.1, 3.3, 5.3
-   NFR7: 1.2, 2.5

## Done Definition

All tasks (1–8) checked; tests & manual verification complete; no regressions; docs updated.
