---
artifact_id: 6d6fb70f-3c9a-4a9f-85d2-6b1bf07ae6d7
name: Conversation Branching Requirements
---

# Introduction

We will implement **conversation branching** (thread forking & navigation) in the local chat app so users can explore alternate continuations from any prior message without losing history. The DB already supports `parent_thread_id` and `forked` flags. This phase adds a robust UX + APIs for creating, visualizing, traversing, and managing branch trees while keeping message queries performant and preventing index fragmentation or accidental data loss.

Objectives:

-   Fast fork creation (O(n messages) only when copying; default no-copy).
-   Intuitive UI affordances to branch at any user or assistant message.
-   Deterministic sparse message indexing preserved per thread.
-   Clear lineage: ability to see ancestor chain and siblings.
-   Retry-as-branch semantics (turn a retry into a fork instead of overwriting).
-   Non-destructive: never mutates source thread messages when branching.
-   Hooks for extension (analytics, autosave, remote sync later).

# Requirements

## 1. Create Branch From Message

User Story: As a user, I want to branch a conversation from any earlier message to explore an alternative path while retaining the original.
Acceptance Criteria:

-   WHEN user selects "Branch from here" on a message (id M, thread T) THEN system SHALL create a new thread F with `parent_thread_id = T` and `forked = true`.
-   WHEN branch is created THEN system SHALL copy all messages in T with `index <= M.index` into F preserving original ordering and sparse indexes OR (config flag) copy none except the last selected message (default: copy up-to anchor).
-   WHEN branch created THEN new thread title SHALL default to original thread title + `• alt` (or first 6 words of anchor message if no title) unless user edits inline.
-   IF source thread not found or message not in thread THEN system SHALL abort and show error toast.

## 2. Branch Without Copy (Light Fork)

User Story: As a power user, I want to create an empty branch that references history implicitly to save storage.
Acceptance Criteria:

-   WHEN user holds modifier (e.g., Alt+Click) on "Branch" THEN system SHALL create fork thread with **no copied messages**; first new user message in fork SHALL reference ancestor chain for context (see Req 6 context assembly).
-   WHEN listing messages in such a branch THEN UI SHALL display ancestor history in read-only mode above a visual divider (not persisted duplicates).

## 3. Visualize Branch Lineage

User Story: As a user, I want to understand where a branch came from and navigate between branches.
Acceptance Criteria:

-   WHEN viewing a thread with a `parent_thread_id` THEN UI SHALL show breadcrumb: Root Thread > ... > Parent > Current.
-   WHEN thread has child branches THEN UI SHALL show a branch indicator (badge with count) and expandable list of child threads.
-   IF branch depth > 6 THEN breadcrumb SHALL collapse middle ancestors into an overflow dropdown.

## 4. Branch Discovery & Navigation Panel

User Story: As a user, I want a side panel to explore all branches of a project hierarchically.
Acceptance Criteria:

-   WHEN user opens Branch Explorer THEN system SHALL render a tree of threads grouped by `parent_thread_id` (root threads first by `updated_at desc`).
-   Tree nodes SHALL lazily load children (no full scan) unless project < 200 threads (config threshold) THEN eager load.
-   Selecting a node SHALL navigate to thread view preserving scroll position state per thread.

## 5. Prevent Accidental Duplicate Branches

User Story: As a user, I don't want to create redundant branches from the same anchor and title.
Acceptance Criteria:

-   WHEN creating a fork for (thread T, anchor message A) THEN system SHALL check for existing fork where `parent_thread_id = T` AND `last_message_at = null` AND metadata anchor_id = A.id (stored transiently in thread title JSON or future meta table) THEN system SHALL prompt to reuse or force new.
-   Default SHALL be reuse existing empty fork if found.

## 6. Context Assembly For AI From Branch

User Story: As a user, I want AI replies in a branch to include appropriate ancestor history.
Acceptance Criteria:

-   WHEN sending a message in fork F THEN system SHALL assemble prompt context consisting of all copied local messages in F plus (if light fork w/out copies) the ancestor thread messages up to anchor (bounded by token limit constant) in chronological order.
-   System SHALL avoid duplicating identical history segments if they already exist in F.
-   IF total tokens exceed limit THEN system SHALL truncate earliest ancestor messages first, preserving anchor message.

## 7. Retry-As-Branch

User Story: As a user, I want to transform a retry into a new branch so original stays intact.
Acceptance Criteria:

-   WHEN user clicks "Retry as Branch" on assistant reply R (following user message U) THEN system SHALL create a fork anchored at U.index and copy messages through U (not R) into new fork before sending retry prompt.
-   Original thread SHALL remain unchanged.

## 8. UI Indicators & Styling

User Story: As a user, I need clear differentiation between original and branched threads.
Acceptance Criteria:

-   Forked thread cards/list entries SHALL display a branch icon.
-   Messages copied from ancestor SHALL display subtle "(from parent)" hover label.
-   Divider SHALL label: "Ancestor History (read-only)" for light forks.

## 9. Performance Constraints

User Story: As a performance-minded developer, I want branching to scale.
Acceptance Criteria:

-   Creation of a branch with copy of N messages SHALL complete in < 50ms for N ≤ 200 on modern laptop (baseline metric; measure with performance marks).
-   Branch Explorer tree expansion for node with ≤ 20 children SHALL resolve in < 16ms average (excluding Dexie I/O) after initial warm cache.
-   Thread view render with ancestor read-only messages SHALL virtualize if total messages > 300.

## 10. Data Integrity & Indexing

User Story: As a developer, I want indexes to remain efficient.
Acceptance Criteria:

-   Branch creation SHALL NOT introduce new Dexie indexes (reuse existing schema).
-   Copied messages SHALL receive new `id`s and preserved `index` spacing; if collision arises (rare) system SHALL normalize indexes via existing `normalizeThreadIndexes` utility post-copy.
-   Light forks SHALL store only anchor reference metadata (see Req 11) to reconstruct history.

## 11. Anchor Metadata Persistence

User Story: As a developer, I need to know which message a light fork derives from.
Acceptance Criteria:

-   Light fork creation SHALL persist an anchor record (temporary approach: JSON encoded prefix in `title` like `{"anchor":"<messageId>","mode":"light"}|<userTitle>` OR dedicated kv entry keyed `thread_anchor:<threadId>`).
-   Retrieval utilities SHALL parse this metadata quickly (<0.1ms parse aim) and cache in-memory map.

## 12. Deleting / Pruning Branches

User Story: As a user, I want safe branch deletion.
Acceptance Criteria:

-   Soft-deleting a parent thread SHALL NOT cascade delete children; Branch Explorer SHALL indicate orphaned branches (parent deleted) with warning badge.
-   WHEN deleting a branch with children THEN system SHALL prompt user to confirm; default action SHALL keep children (re-parent to deleted thread's parent) unless user chooses cascade.

## 13. Conflict / Race Handling

User Story: As a developer, I want thread forking operations to be atomic.
Acceptance Criteria:

-   Branch creation and message copy SHALL run in a single Dexie transaction across `threads` and `messages` tables.
-   IF transaction fails (e.g., quota error) THEN no partial fork thread SHALL remain.

## 14. Hooks Integration

User Story: As an extension dev, I want to intercept branching.
Acceptance Criteria:

-   Hooks SHALL exist: `db.threads.fork:filter:options`, `ui.thread.branch:action:before`, `ui.thread.branch:action:after`, `ai.context.branch:filter:messages`.

## 15. Accessibility & Keyboard Support

User Story: As a keyboard user, I want to branch quickly.
Acceptance Criteria:

-   Focused message + shortcut (e.g., Cmd+B) SHALL open branch creation modal with anchor pre-selected.
-   Branch Explorer SHALL be navigable via arrow keys and Enter to open thread.

## 16. Testing & QA

User Story: As a developer, I want automated validation of branching logic.
Acceptance Criteria:

-   Unit tests (or dev harness script) SHALL verify: branch copy correctness, light fork ancestor assembly, retry-as-branch, duplicate prevention.
-   Performance marks SHALL be logged with label prefix `branch:`.

## 17. Non-Functional Requirements

Acceptance Criteria:

-   All new code SHALL be TypeScript.
-   No blocking synchronous loops over > 500 messages; use chunked async yields for extreme cases.
-   Branch metadata parsing SHALL avoid JSON.parse in tight render loops (cache results).
-   UI SHALL remain responsive (no frame > 50ms) during branch creation.
