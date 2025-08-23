---
name: Simple Branching Task List
summary: Minimal, functional branching system (fork + retry + context) without advanced metadata, hooks, caching, or performance layers.
version: v1-slim
---

# Minimal Branching Implementation

Goal: Ship the smallest useful branching feature: fork a thread at a user message (reference or copy), retry an assistant turn by branching at its preceding user, and build context for AI calls. No JSON-in-title, no hooks, no caching, no token budgeting, no performance marks.

## Core Principles

-   Store branch state directly in thread columns.
-   Only two fork modes: `reference` (reuse ancestor messages) and `copy` (duplicate earlier messages into new thread).
-   Context for AI = ancestor slice (up to anchor) + local branch messages (reference mode) OR just local messages (root/copy mode).
-   Keep UI additions minimal (message action menu + basic toast + navigation).
-   Keep schema migration small and forward-only.

## Task Checklist

### 1. Schema & Types

-   [x] 1.1 Add fields to `threads` schema: `parent_thread_id?`, `anchor_message_id?`, `anchor_index?` (number), `branch_mode?` ('reference' | 'copy').
-   [x] 1.2 Bump Dexie DB version with upgrade adding new indexes if needed (e.g. `[parent_thread_id+anchor_index]` if useful later; optional for MVP).
-   [x] 1.3 Update TypeScript `Thread` interface.
-   [x] 1.4 Data backfill: existing rows get `branch_mode = null` (implicitly root).

### 2. Core Branching Module

-   [x] 2.1 Create `app/db/branching.ts` with exports: `forkThread`, `retryBranch`, `buildContext` (per user’s simple examples).
-   [x] 2.2 Implement `forkThread` supporting `mode: 'reference' | 'copy'` and optional `titleOverride`.
-   [x] 2.3 Implement `retryBranch(assistantMessageId, mode)` (find preceding user message and call `forkThread`).
-   [x] 2.4 Implement `buildContext({ threadId })` (ancestor slice + locals for reference; locals only for copy/root).
-   [x] 2.5 Add minimal input validation / error throwing (source thread exists, anchor belongs to source, roles, etc.).

### 3. UI Integration (Minimal)

-   [ ] 3.1 Add "Branch from here" action to user messages (opens small inline popover/modal with mode + optional title + Create button).
-   [ ] 3.2 Add "Retry as Branch" action to assistant messages (auto-select preceding user anchor; maybe skip extra UI unless changing mode/title).
-   [ ] 3.3 After creation: navigate to new thread route and show success toast (e.g. "Branched: <title>").
-   [ ] 3.4 Indicate branched thread in header: simple badge "Branch" if `parent_thread_id` present.
-   [ ] 3.5 (Optional nice-to-have) Button in branched thread to "Open Parent".

### 4. Message Send Flow

-   [ ] 4.1 On AI context assembly (wherever messages assembled now), replace logic with call to `buildContext` when thread has `parent_thread_id`.
-   [ ] 4.2 Ensure no duplicate messages if user already sees ancestor messages in UI (UI can continue to render only local messages for MVP; context building is independent).
-   [ ] 4.3 (Optional) For reference branches, visually mark ancestor boundary with a simple divider if time allows (not required for functionality).

### 5. Navigation & State

-   [ ] 5.1 Ensure new thread added to in-memory thread list/store after fork.
-   [ ] 5.2 Ensure selection switching triggers message list refresh.
-   [ ] 5.3 No special indexing normalization beyond what `forkThread` already handles (copy mode resets indexes starting at 0).

### 6. Testing (Basic Scripts or Manual Steps)

-   [ ] 6.1 Create root thread with 3 user+assistant pairs; branch at 2nd user (reference) → verify new thread has 0 local messages initially & metadata correct.
-   [ ] 6.2 Branch same anchor with copy mode → verify duplicated messages count matches slice length & indexes start at 0.
-   [ ] 6.3 Retry-as-branch from assistant #3 → anchor = preceding user (#3's user); verify new thread anchor points correctly.
-   [ ] 6.4 Send a new message in reference branch → ensure context includes ancestor slice + new message.
-   [ ] 6.5 Send a new message in copy branch → ensure context includes only copied + new message (all local).

### 7. Error / Edge Cases

-   [ ] 7.1 Attempt branch with invalid anchor id → throws.
-   [ ] 7.2 Attempt retry with assistant message lacking preceding user → throws.
-   [ ] 7.3 Branching at last user message allowed (creates empty branch ready for alt continuation).
-   [ ] 7.4 Prevent branching from system/tool messages (only user anchors) – enforce in UI.

### 8. DX & Docs

-   [ ] 8.1 Add short README section `Branching (Minimal)` describing modes and functions.
-   [ ] 8.2 JSDoc headers on the three exported functions (inputs, returns, errors).
-   [ ] 8.3 Note future extensions (caching, metrics, explorer tree) in a "Next Ideas" subsection.

### 9. Cleanup / Non-Functional

-   [ ] 9.1 Type-safety: no `any` usage introduced.
-   [ ] 9.2 Keep module under ~150 LOC.
-   [ ] 9.3 No new dependencies.
-   [ ] 9.4 Keep UI additions styled with existing retro classes (no new color vars).

## Deliverable Definition of Done

-   Can create reference or copy branch from a user message.
-   Can retry from an assistant message (auto-branch).
-   New thread opens automatically; toast confirms.
-   AI context resolves correctly for both modes.
-   Minimal docs & basic manual test steps validated.

## Next Ideas (Explicitly Out of Scope Now)

-   Branch explorer tree
-   Token budgeting / truncation
-   Performance instrumentation
-   Hook system integration
-   Anchor metadata caching
-   Duplicate branch detection & reuse

---

This slim list supersedes the complex plan for the first shippable branching iteration. Use only this until core UX validated.
