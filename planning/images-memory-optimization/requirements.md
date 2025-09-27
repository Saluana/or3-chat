# Requirements: Images Grid Memory Optimization

artifact_id: 4a3d1b2f-0f29-4a12-9217-30c5e0b2b7a4

## Introduction

Optimize the dashboard images experience to cap preview memory usage without hurting scroll or viewer responsiveness. The scope covers `GalleryGrid.vue` and `ImageViewer.vue`, introducing lightweight eviction, shared preview reuse, and basic telemetry so long browsing sessions stay stable on low-memory devices.

## Requirements

### Requirement 1: Bounded preview cache

**User Story:** As a user scrolling large galleries, I want the grid to keep memory usage under control so my browser stays responsive.

**Acceptance Criteria**

-   **WHEN** preview blobs exceed configurable count or byte limits **THEN** the component SHALL revoke the oldest non-visible URLs before loading new ones.
-   **WHEN** the tab loses visibility or the grid unmounts **THEN** the component SHALL flush all non-visible previews within one animation frame.
-   **IF** revocation fails **THEN** the component SHALL log via `reportError` and continue eviction for remaining entries.

### Requirement 2: Shared preview lifecycle

**User Story:** As a user opening the full-screen viewer, I want previews to load instantly without duplicating memory so that navigation feels smooth.

**Acceptance Criteria**

-   **WHEN** the viewer requests a preview for a hash already cached by the grid **THEN** it SHALL reuse the existing URL instead of fetching a new blob.
-   **WHEN** the viewer closes **THEN** the shared cache SHALL downgrade the preview priority but KEEP the URL alive if it remains within the hot limit.
-   **IF** the cache evicts a viewer preview **THEN** reopening SHALL trigger a fresh fetch without throwing.

### Requirement 3: Minimal telemetry & tuning hooks

**User Story:** As a maintainer, I want simple metrics and knobs so I can tune memory limits per environment.

**Acceptance Criteria**

-   **WHEN** `process.dev` is true **THEN** the system SHALL log current preview counts, total estimated bytes, and eviction counts after each eviction pass.
-   **WHEN** limits need adjusting **THEN** the component SHALL read caps from a single exported options object so they can be tweaked without code duplication.
-   **IF** the environment provides `navigator.deviceMemory` **THEN** the caps SHALL default lower for ≤4 GB devices.
