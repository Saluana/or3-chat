artifact_id: 8c9a0d3b-6f8c-4f27-9f6a-5f2b9f9d2e67
content_type: text/markdown

# requirements.md

## Introduction

This document defines the requirements for the Mentions in ChatInputDropper plugin. The plugin enables @-mentioning of documents and chats in the chat composer. Mentions resolve to structured entities and inject relevant context into the LLM request at send time. The solution must be an optional Nuxt plugin (registered in `app/plugins`), with all logic encapsulated in a subdirectory for maintainability.

Scope:

-   TipTap mention extension triggered by `@` with grouped autocomplete results from a local Orama index.
-   Resolution of selected mentions into context appended to the LLM input before sending.
-   Index maintenance for documents and chat threads with low-latency fuzzy search.
-   Plugin-only implementation (no core edits), leveraging existing hook system.

Assumptions:

-   Tech stack: Nuxt 3/4, TypeScript, TipTap v2 with `@tiptap/extension-mention` + `@tiptap/suggestion` + `tippy.js`, Dexie-based local DB in `app/db/*`, Orama for local search.
-   Hooks per `docs/core-hook-map.md` are available on the client.

## Requirements

### 1. Mention Autocomplete

User Story: As a user, I want to type `@` in the chat editor and quickly find documents and chats to mention, so that I can inject relevant context into my prompt.

Acceptance Criteria:
1.1 WHEN the user types `@` in the editor THEN the plugin SHALL open an autocomplete dropdown within 150ms and show grouped results: "📄 Documents" and "💬 Chats".
1.2 WHEN the user types characters after `@` THEN the plugin SHALL fuzzy search against document titles/filenames and chat titles with a debounce of 250–300ms.
1.3 WHEN results are shown THEN the plugin SHALL display up to 5 results per group with label and subtle subtitle (e.g., thread message snippet or path) and keyboard navigation support.
1.4 WHEN the user selects a result THEN the plugin SHALL insert a non-editable mention node with attributes `{ id, source: 'document'|'chat', label }` and a distinct `.mention` style.
1.5 WHEN backspace is pressed at the right edge of a mention THEN the plugin SHALL delete the entire mention token.
1.6 The implementation SHALL use the official TipTap Mention extension with Suggestion and tippy.js (no custom ProseMirror mention implementation).

### 2. Mention Node Structure

User Story: As a developer, I want mention nodes to have stable metadata so they can be resolved later, so that context injection is deterministic.

Acceptance Criteria:
2.1 The mention node SHALL have JSON shape `{ type: 'mention', attrs: { id: string, source: 'document'|'chat', label: string } }` and be non-editable.
2.2 The inserted node SHALL preserve surrounding text spacing (no extra or missing whitespace at boundaries).
2.3 IF the editor content is exported to Markdown or plain text THEN the mention SHALL render as the label (e.g., `@ProjectPlan.docx`) without leaking internal IDs.

### 3. Local Search Index (Orama)

User Story: As a user, I want search to be fast and private, so that mentions are responsive and offline-friendly.

Acceptance Criteria:
3.1 The plugin SHALL create a local Orama index with schemas for documents and chats on client init.
3.2 The index SHALL include fields: documents → `{ id, title, tags? }`; chats → `{ id, title, snippet? }` and be searchable with fuzzy matching.
3.3 The index SHALL update on relevant DB events (create/update/delete) for `documents` and `threads` with delay < 300ms from mutation to index availability.
3.4 IF Orama is not yet ready THEN the plugin SHALL render a loading state and fallback to empty results without errors.

### 4. Context Resolution and Injection

User Story: As a user, I want mentioned resources to be included in the model’s context automatically, so that I don’t need to paste content manually.

Acceptance Criteria:
4.1 WHEN the user clicks send THEN the plugin SHALL traverse the TipTap JSON to collect all mention nodes in order of appearance.
4.2 For document mentions, the plugin SHALL resolve `db.documents.get(id)` and retrieve the latest persisted document content as plain text.
4.3 For chat mentions, the plugin SHALL resolve the thread by id and fetch its messages (ordered) from `db.messages.byThread` (or equivalent), reducing to plain text.
4.4 The plugin SHALL inject context via `ai.chat.messages:filter:input` as additional messages or extra text parts with clear headers, e.g.: - "(Referenced Document: <label>)\n<content>" - "(Referenced Chat: <label>)\n<transcript>"
4.5 IF the resolved content exceeds limits (50KB or ~10k tokens) THEN the plugin SHALL truncate aggressively to the first N characters with a suffix indicator, and include a header noting truncation.
4.6 Duplicate mentions of the same id in a single message SHALL be de-duplicated during injection, preserving first occurrence order.
4.7 IF a mentioned id cannot be resolved THEN the plugin SHALL omit it from injection and append a warning footer message in the payload noting the missing reference (non-blocking).

### 5. Plugin Lifecycle and Registration

User Story: As a maintainer, I want a contained, optional plugin that integrates via hooks without forking core code, so that maintenance and upgrades are simple.

Acceptance Criteria:
5.1 The plugin SHALL be registered in the root of `app/plugins` (e.g., `mentions.client.ts`) so Nuxt picks it up; all logic SHALL live under `app/plugins/Mentions/*`.
5.2 The plugin SHALL register/unregister all hooks and UI registries cleanly on HMR dispose.
5.3 The plugin SHALL not mutate core state directly; it SHALL use hooks listed in `docs/core-hook-map.md` (notably `ai.chat.messages:filter:input`, `ui.chat.message:filter:outgoing` optionally, and DB hooks for index maintenance).

### 6. UI and Accessibility

User Story: As a user, I want a clean, accessible mention UI that matches the app styling.

Acceptance Criteria:
6.1 Mention tokens SHALL have a subtle background, icon, and hover delete affordance, with screen-reader labels.
6.2 The autocomplete dropdown SHALL support keyboard navigation, ARIA roles, and focus management; it SHALL close on Escape and commit on Enter.
6.3 The dropdown SHALL show at most 10 total items (5 per group cap) to avoid visual overload.

### 7. Performance and Reliability

User Story: As a user, I want the feature to be fast and stable.

Acceptance Criteria:
7.1 Searches SHALL return within 50ms p95 on a dataset of 5k items on a typical laptop.
7.2 Index memory footprint SHALL remain under 20MB for 5k items (guideline; not enforced at runtime).
7.3 Resolution at send time SHALL add less than 120ms p95 when injecting up to 2 mentions with total content under 100KB.
7.4 Errors in mention resolution SHALL not block sending; they SHALL be logged (dev) and surfaced as non-fatal warning context.

### 8. Configuration and Safety

User Story: As an admin or power user, I want sane defaults and safe fallbacks.

Acceptance Criteria:
8.1 The plugin SHALL expose minimal config: debounce (default 275ms), max results per group (default 5), truncation size (default 50KB).
8.2 IF the plugin is disabled (feature flag) THEN no editor extension or hooks SHALL be registered.
8.3 The index SHALL only use local data and SHALL not issue network requests.

## Non-functional Requirements

-   Privacy: All search and resolution happen locally.
-   Compatibility: Works with TipTap v2 and existing editor setup. No SSR requirement; client-only plugin is acceptable.
-   Maintainability: Encapsulated in `app/plugins/Mentions/*` with root registration file.
-   Testability: Unit tests for parsing and resolution; integration tests using the hooks engine; performance checks on search latency.
