# requirements.md

artifact_id: 4a9e5a02-9d07-4c6c-bbb5-2f5f3f8bb0f0

## Introduction

Early Message Normalization introduces a single canonical internal representation for chat messages to eliminate oscillation between string and parts-array formats. This reduces conditional rendering logic, watcher proliferation, and cognitive overhead while preserving all existing external behaviors and plugin compatibility.

This plan is extended to FIRST perform File Hash / Image Logic Unification so that every subsequent normalization step operates on already‑standardized attachment metadata, preventing duplicate tolerant parsing utilities from proliferating inside the message helpers. Attachment / image normalization is therefore the entry point to the refactor sequence.

## Functional Requirements (User Stories)

### 0. File Hash & Image Logic Unification (Must Happen First)

As a developer, I want a single tolerant utility layer for parsing, merging, and normalizing image / file hash inputs so that message normalization and UI components can rely on pre-parsed arrays without repeating JSON parsing or ad-hoc merging rules.
Acceptance Criteria:

-   WHEN legacy serialized hashes (JSON string, comma string, or array) are passed to `parseHashes` THEN it SHALL return a clean `string[]` or `[]` on error without throwing.
-   IF previous assistant message has `file_hashes` AND the current assistant placeholder supplies new `file_hashes` THEN `mergeAssistantFileHashes(prev, current)` SHALL return a de-duplicated ordered union (previous order preserved; new unique hashes appended).
-   WHEN images parameter variants (string URL, array of URLs, objects with `{ url | data | mime }`) are passed to `normalizeImagesParam` THEN it SHALL return an array of `NormalizedAttachment { kind: 'image', hash?: string, src: string, mime?: string }` with invalid entries skipped.
-   IF malformed input (null, undefined, non-iterables) is provided to any helper THEN it SHALL return an empty array safely.
-   Helpers SHALL be pure (no side-effects, no global mutation) and tree-shakeable.
-   Unit tests SHALL cover: mixed hash formats, duplicate merges, malformed JSON, large arrays (>100 items trimmed only if future limits imposed — current behavior: do not trim), image object variants.

Rationale: Eliminates scattered `try { JSON.parse } catch {}` and merging branches that would otherwise have to be updated again after normalization, and ensures the canonical `UiChatMessage.file_hashes` field is consistently shaped from the start.

### 1. Canonical UI Message Shape

As a developer, I want every in-memory chat message exposed to UI components to share a single interface so that components can consume `.text` without defensive shape checks.
Acceptance Criteria:

-   WHEN a user or assistant message is added THEN it SHALL be stored as `UiChatMessage` containing `{ id, role, text: string, file_hashes?: string[], reasoning_text?: string }`.
-   IF original raw parts exist (arrays, multimodal objects) THEN they SHALL be kept only in a non-reactive legacy store not used by UI rendering.
-   WHEN components read messages THEN they SHALL never encounter an array for content.

### 2. Boundary Normalization

As a developer, I want normalization to occur exactly once at message creation so that no downstream transformations are required.
Acceptance Criteria:

-   WHEN `sendMessage` is invoked THEN user message SHALL be normalized before being pushed to the reactive messages array.
-   WHEN assistant streaming begins THEN an assistant placeholder SHALL be inserted already in canonical form with empty `text`.
-   WHEN streaming appends tokens THEN only the `.text` field SHALL be mutated (concatenated) without changing structure.
-   WHEN `retryMessage` is called THEN the retried message SHALL be re-normalized using the same helper functions.

### 3. Helper Utilities

As a developer, I want small pure helpers to convert legacy part formats to text so that logic is centralized and testable.
Acceptance Criteria:

-   GIVEN an array of parts containing strings or objects with `{ type: 'text', text }` WHEN passed to `partsToText` THEN it SHALL return a single concatenated string preserving order.
-   GIVEN malformed parts (null/unknown) THEN `partsToText` SHALL skip them without throwing.
-   `ensureUiMessage` SHALL accept legacy message variants and return a `UiChatMessage`.

### 4. Backward Compatibility Layer

As a plugin author, I need continued access to original raw message structures during migration so that no immediate refactor is forced.
Acceptance Criteria:

-   A legacy accessor (e.g. `getRawMessages()` or symbol-based property) SHALL expose the original raw messages for existing hook/filter pipelines.
-   Legacy raw storage SHALL be non-reactive (or shallow readonly) to prevent accidental UI dependency creation.
-   Normalized UI list SHALL remain source-of-truth for rendering.

### 5. Removal of Redundant Mapping Logic

As a maintainer, I want to delete mapping/watcher code that only existed to reconcile mixed shapes so that code size is reduced.
Acceptance Criteria:

-   Code in `ChatContainer.vue` performing array→string mapping SHALL be removed or replaced with a direct pass-through of normalized messages.
-   Defensive branches in `ChatMessage.vue` checking `Array.isArray(content)` or `typeof === 'string'` SHALL be removed.
-   No new runtime errors introduced (build + basic chat flow smoke test passes).

### 6. No Functional Regression

As a user, I want chat behavior unchanged aside from internal simplification so that UX remains stable.
Acceptance Criteria:

-   Message sending, streaming, retrying, and attachment display continue to function as before.
-   Performance (time to first streamed token shown) SHALL be unaffected (±5% tolerance) in measurement harness.

## Non-Functional Requirements

-   Simplicity: Message helpers ≤ ~40 LOC combined (hash/image helpers may extend total but remain individually < 25 LOC each).
-   Safety: 100% unit test coverage for helper edge cases (empty parts, mixed types, nulls).
-   Backward Compat Duration: Layer retained until separate deprecation plan; no direct removal in this refactor.
-   Documentation: Added brief usage section in planning docs (design) describing migration path.
-   Reuse: All code performing file hash parsing or merging MUST call the new helpers (grep for previous patterns eliminated in final diff).

## Out of Scope

-   Streaming architecture overhaul (covered by separate item #1 doc).
-   Attachment composable extraction (beyond normalization utilities here).
-   Reasoning channel refactor (future item).

Note: File hash / image logic IS NOW IN SCOPE (moved from other refactor item) to unblock early normalization.

## Acceptance / Sign-off Checklist

-   [ ] All acceptance criteria above satisfied.
-   [ ] Tests added & passing.
-   [ ] Redundant code removed (diff reviewed).
-   [ ] Build & smoke test pass.
-   [ ] Documentation updated.
