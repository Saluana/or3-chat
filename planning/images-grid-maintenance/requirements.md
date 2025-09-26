# Requirements: Images Grid Performance & Cleanup

artifact_id: 1b4ff9b4-0b2c-4cc9-9dd5-8b51e3df4ad8

## Introduction

This initiative addresses performance and maintenance gaps in the dashboard images experience. It focuses on reducing memory churn from preview object URLs, smoothing IntersectionObserver bindings, and tightening the images page module to remove dead code and redundant state flags. The scope covers `GalleryGrid.vue` and `pages/images/index.vue`, preserving existing UX while improving reliability on large galleries and low-memory devices.

## Requirements

### Requirement 1: Preview URL lifecycle management

**User Story:** As a power user browsing deep galleries, I want preview URLs for images I scroll past to be cleaned up automatically so that long sessions do not exhaust browser memory.

**Acceptance Criteria**

-   **WHEN** the `items` prop loses hashes that previously had preview URLs **THEN** the component SHALL revoke the associated `URL.createObjectURL` values before discarding its references.
-   **WHEN** the `items` prop is cleared (e.g., filter reset or mode change) **THEN** the component SHALL revoke all cached preview URLs within one animation frame.
-   **IF** a revoke attempt throws (e.g., double revoke) **THEN** the component SHALL catch the error, log via `reportError`, and continue processing remaining hashes.

### Requirement 2: Throttled IntersectionObserver rebinds

**User Story:** As a user rapidly paging or toggling modes, I want the grid to remain responsive so that re-render bursts do not create jank.

**Acceptance Criteria**

-   **WHEN** `items` changes successively within a 50 ms window **THEN** the grid SHALL coalesce observer rebinds into a single execution (via `requestIdleCallback`, `setTimeout`, or a reusable scheduler).
-   **WHEN** the component becomes visible after throttling **THEN** the observer setup SHALL still process all tiles and lazily load previews for visible hashes.
-   **IF** the browser lacks `requestIdleCallback` **THEN** the component SHALL fall back to a `setTimeout`-based micro-throttle without throwing runtime errors.

### Requirement 3: Images page module hygiene

**User Story:** As a maintainer, I want the images index module to avoid unused code and redundant derived state so that future changes remain straightforward.

**Acceptance Criteria**

-   **WHEN** building the app **THEN** `pages/images/index.vue` SHALL compile without unused imports or local symbols (e.g., only importing `getFileBlob` if it is executed).
-   **WHEN** referencing mutation status in the view **THEN** the module SHALL reuse derived booleans (`isMutating`, `isSoftDeleting`, etc.) instead of recomputing equivalent logic inline.
-   **IF** additional mutation states are introduced **THEN** the union type SHALL remain locally encapsulated with accompanying runtime guards or computed fallbacks.

### Requirement 4: Documentation & regression safeguards

**User Story:** As a QA engineer, I want clear regression coverage so that these optimizations are verifiable.

**Acceptance Criteria**

-   **WHEN** automated component tests execute **THEN** they SHALL assert that preview URLs are revoked when items are removed and that observers rebind once per change burst.
-   **WHEN** linting runs **THEN** no new warnings SHALL appear related to unused symbols or implicit `any` types in the touched files.
-   **IF** a regression is detected **THEN** the plan SHALL include remediation steps via tasks and design notes.
