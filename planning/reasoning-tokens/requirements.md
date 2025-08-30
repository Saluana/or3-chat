# requirements.md

artifact_id: 8c3b1e4a-5f5c-4a41-9d88-8f1d6b5f3d7f

## Introduction

Add minimal support for capturing and displaying AI model reasoning tokens ("reasoning content") for assistant messages returned from OpenRouter reasoning-capable models. Reasoning text will be stored inside existing `Message.data` as `reasoning_content` (raw string) plus optional `reasoning_details` (array) without altering schema types. UI will show an accordion at top of assistant message bubble (retro theme) when reasoning exists. Keep implementation tiny, performant, and backwards compatible; no migration needed.

## Functional Requirements

### R1 Store Reasoning Content

As a developer, I want reasoning output stored in `Message.data.reasoning_content` (and optionally `reasoning_details`) so that it persists with the message without new DB columns.
Acceptance Criteria:

-   WHEN an assistant completion response includes a `reasoning` (string) or `reasoning_details` array THEN they SHALL be inserted into `Message.data` under keys `reasoning_content` (string) and `reasoning_details` (array) respectively.
-   IF neither field is present THEN `Message.data` SHALL remain unchanged.
-   Stored data SHALL survive page reload and be retrievable via existing message load logic.

### R2 Display Reasoning Accordion

As a user, I want to view (and optionally collapse) the reasoning above the assistant message so that I can inspect thinking steps without clutter.
Acceptance Criteria:

-   GIVEN an assistant message with `data.reasoning_content` (non-empty) WHEN rendered THEN an accordion header SHALL appear above the message content inside the same bubble.
-   Default state SHALL be collapsed (show header with a short label like "Show reasoning" and token length count) and expand on click.
-   Expanded view SHALL show the reasoning in a monospace, small, scrollable block with retro styling consistent with existing theme (reuse utility classes, minimal new CSS).
-   Toggling SHALL not affect other messages (state isolated per message, not global).

### R3 Graceful Fallback & Safety

As a user, I want the reasoning feature to not break existing messages or streaming.
Acceptance Criteria:

-   IF `Message.data.reasoning_content` absent THEN no accordion UI SHALL render.
-   IF reasoning string extremely long (>20k chars) THEN the UI SHALL cap max height (~300px) with overflow scroll.
-   Streaming of main message content SHALL proceed unaffected even if reasoning absent or delayed.

## Non-Functional Requirements

-   NFR1: Zero schema migrations (reuse `data` field only).
-   NFR2: Incremental loading cost negligible: reasoning parsing O(1) in render (no expensive transforms).
-   NFR3: Added client code under ~120 LOC (target) to keep footprint small.
-   NFR4: Accessible: accordion button SHALL have `aria-expanded` and `aria-controls` attributes.
-   NFR5: No new dependencies.

## Out of Scope

-   Editing reasoning content.
-   Searching/filtering by reasoning tokens.
-   Multi-format rendering of structured `reasoning_details` objects (we treat as plain concatenated text if present).

## Edge Cases

-   Empty string reasoning -> treated as absent.
-   Both `reasoning` string and `reasoning_details` text segments: concatenate text segments in order if needed.
-   Malformed `data` (not object) -> ignore reasoning.

## Acceptance Summary

R1: Persist reasoning fields. R2: Show collapsible reasoning UI. R3: Safe no-op when absent. NFR1-5 met.
