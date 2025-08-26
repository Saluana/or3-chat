# requirements.md

artifact_id: 3b0c9c4d-45f9-4c4d-9f3c-5f0e7d1c8d9f

## Introduction

Add lightweight, performant client-side search for Projects and Documents in the existing sidebar, reusing the approach used for threads (`useThreadSearch`). A single input should filter: (a) thread list, (b) project names, and (c) document titles (both standalone docs list and docs inside project trees). Must feel instant (<30ms perceived on 500 items) and gracefully fallback to substring match if the in-memory index lib fails.

## Scope

In-scope: local (browser) search only; no server calls; indexing name/title + basic metadata timestamp for ordering boost. Out-of-scope: full text content, fuzzy ranking beyond simple relevance, multi-field advanced UI.

## Requirements

### 1. Unified Sidebar Query

As a user, I want one search box to filter threads, projects, and documents so I can quickly locate any item without switching modes.
Acceptance Criteria:

-   WHEN user types in the existing sidebar input THEN threads, projects, and documents lists SHALL reflect filtered results in real time (debounced ≤150ms).
-   IF query is empty THEN all original lists SHALL display unchanged.
-   WHILE indexing is in progress THEN UI MAY show a subtle busy state (spinner or dim) but SHALL remain interactive.

### 2. Project Filtering Behavior

As a user, I want project tree display to collapse to only matching projects or those containing matching entries so noise is reduced.
Acceptance Criteria:

-   WHEN query non-empty THEN only projects whose name matches OR that contain at least one matching entry (chat/doc) SHALL display.
-   WHEN a project contains matches THEN only its matching entries SHALL render (others hidden) unless query cleared.
-   IF no projects match THEN project section SHALL show an empty state label "No projects" (non-intrusive, small text).

### 3. Documents List Filtering

As a user, I want the documents section to show only documents whose title matches the query text.
Acceptance Criteria:

-   WHEN query non-empty THEN documents list SHALL contain only matching document titles (case-insensitive substring or indexed hits).
-   IF no documents match THEN a small "No documents" placeholder SHALL appear.

### 4. Performance & Fallback

As a user, I need search to be fast and reliable even on large local datasets.
Acceptance Criteria:

-   GIVEN up to 2000 combined items THEN first search response (cold index build) SHALL complete <300ms on mid-range laptop; subsequent queries <30ms average (excluding debounce).
-   IF index build or search throws THEN system SHALL fallback to simple lowercase substring filtering for all 3 domains in same pass.
-   Index rebuild SHALL only occur when counts or updated_at clocks change (no rebuild on harmless reactive churn).

### 5. Minimal API & Maintainability

As a developer, I want a concise composable mirroring existing `useThreadSearch` patterns for consistency.
Acceptance Criteria:

-   A new `useSidebarSearch` composable SHALL expose: `{ query, threadResults, projectResults, documentResults, ready, busy, runSearch }`.
-   Composable SHALL internally reuse a generic create/build function with Orama (or substring fallback only if bundle size impact of adding more schema fields is trivial).
-   Added code SHALL not introduce more than ~250 LoC net (excluding tests/docs).

### 6. Non-Destructive UI Changes

As a user, I want existing behaviors unaffected when query is empty.
Acceptance Criteria:

-   Clearing query SHALL fully restore prior expansion state of projects & full lists.
-   No existing rename / create / delete flows SHALL break (verified via smoke interaction after implementation).

### 7. Accessibility

As a user using keyboard, I want seamless focus and clear semantics.
Acceptance Criteria:

-   Search input SHALL retain existing styling and have `aria-label="Search"`.
-   Clearing via ESC key SHALL empty query and restore lists.

### 8. Testing & Verification

As a developer, I want confidence the search works across core cases.
Acceptance Criteria:

-   Unit tests SHALL cover: empty query, match multiple domains, project containing matches only, fallback path when index throws (mock failure), and clear query state restore.
-   Performance test (lightweight) SHALL assert index + first search under threshold with mocked dataset (timing assertions with generous ceiling to avoid flakes).
