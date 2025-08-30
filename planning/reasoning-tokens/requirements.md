# requirements.md

artifact_id: 8c3b1e4a-5f5c-4a41-9d88-8f1d6b5f3d7f

## Introduction

Add lightweight capture + live display of reasoning tokens from reasoning-capable OpenRouter models. Reasoning text is stored only inside existing `Message.data` keys: `reasoning_content` (string) and optional `reasoning_details` (array). A reusable `ReasoningAccordion.vue` shows reasoning both while streaming and after finalization with zero layout shift. No schema changes, no new deps, minimal LOC.

## Functional Requirements

### R1 Capture & Persist Reasoning

As a developer I want reasoning output normalized and stored in `Message.data` so it survives reload without schema changes.
Acceptance Criteria:

-   WHEN a completion (streaming or final) includes `reasoning` (string) or `reasoning_details` (array) THEN they SHALL be normalized and merged into `message.data` before final persistence.
-   IF neither field appears across the entire stream THEN `message.data` SHALL remain unchanged.
-   Persisted reasoning SHALL be identical (modulo whitespace trim) to the final combined stream.

### R2 Final Message Display

As a user I want a collapsible reasoning section above the assistant's final answer so I can inspect it without clutter.
Acceptance Criteria:

-   GIVEN a stored assistant message with non-empty `data.reasoning_content` THEN an accordion header SHALL render above the answer inside the same bubble.
-   Default collapsed; clicking toggles expanded state only for that message.
-   Expanded view SHALL show raw text (pre-wrap) inside scrollable area (max-height 300px).

### R3 Safety & Layout Stability

As a user I want the reasoning feature to never cause jank or break existing chats.
Acceptance Criteria:

-   IF `reasoning_content` absent THEN no accordion markup SHALL render (no blank gap) unless streaming has predicted reasoning (see R4 placeholder rule).
-   Large reasoning (>20k chars) SHALL still render inside capped scroll; no performance degradation beyond O(n) initial concatenation.
-   Main message streaming SHALL proceed even if reasoning extraction fails silently.

### R4 Live Streaming Display

As a user I want to see reasoning tokens appear live (when the model supports them) without the UI jumping once the first token arrives.
Acceptance Criteria:

-   IF the selected model matches a known reasoning-capable list THEN a fixed-height accordion header placeholder (collapsed) SHALL render immediately with a subtle "Thinking…" label until first reasoning token.
-   WHEN first reasoning token arrives THEN the header label SHALL change to "Show reasoning" (still collapsed) without shifting surrounding layout.
-   WHEN expanded during streaming THEN content area SHALL update incrementally (batched ≤ ~120ms intervals) until completion.
-   On completion the final persisted content SHALL match what is visible (apart from possible trailing whitespace trim).

### R5 Reusable Component

As a developer I want a single `ReasoningAccordion.vue` usable by both streaming tail message and regular message rendering for consistency.
Acceptance Criteria:

-   Component props SHALL support: `content`, `streaming`, `pending`, and internal toggle state with accessible attributes.
-   Both streaming and final messages SHALL import and use the same component with no duplicate styling logic.

## Non-Functional Requirements

-   NFR1 Zero schema migrations: only reuse `data`.
-   NFR2 Minimal footprint: ≤ ~140 new LOC total (util + component + integration + tests).
-   NFR3 Performance: streaming updates throttled/batched; no more than one DOM text update per ~80–120ms while tokens arriving.
-   NFR4 Accessibility: toggle button has `aria-expanded`, `aria-controls`, discernible text; focusable reasoning container.
-   NFR5 No new dependencies and no increase in bundle size > 1KB gzip (target).
-   NFR6 Zero layout shift: header (or placeholder) height constant once message row first painted.
-   NFR7 Memory safety: reasoning buffer truncated only if >100k chars (soft cap) with suffix "\n[truncated]".

## Out of Scope

-   Editing or regenerating reasoning.
-   Searching/filtering reasoning.
-   Streaming mid-flight reasoning_details structural visualization (only text combination shown).

## Edge Cases

-   Empty / whitespace-only reasoning -> treated as absent.
-   Invalid `reasoning_details` entries (non-object) -> skipped silently.
-   Both `reasoning` and `reasoning_details`: prefer normalized `reasoning_details` aggregation; fallback to `reasoning` if details empty.
-   Extremely long text (>100k) -> truncate with marker while still storing truncated version (avoid large local memory retention).
-   Malformed `message.data` (non-object) -> initialize fresh object.

## Acceptance Summary

R1 capture+persist, R2 final display, R3 safety/layout, R4 live streaming, R5 reusable component. NFR1–NFR7 satisfied when code + tests meet above criteria.
