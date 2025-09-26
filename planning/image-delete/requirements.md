# Image Library Deletion — Requirements

Artifact ID: 6f1b8d3f-0a42-4ef2-b2f6-4a4c1e5cbe8d

## Introduction

Extend the existing dashboard image library so that users can delete images they no longer need. Support both single-image deletion (from the grid or viewer) and multi-select bulk deletion while keeping the interaction fast, accessible, and consistent with current storage semantics (soft delete via `db.file_meta.deleted`).

## Functional Requirements

R1. Single-image deletion controls

-   User Story: As a user, I want a delete option on each image so I can remove individual items quickly.
-   Acceptance Criteria:
    -   WHEN I click Delete on a gallery tile THEN the app SHALL ask for confirmation and, on approval, SHALL mark the corresponding file `deleted = true` via `softDeleteFile`.
    -   WHEN I click Delete inside the image viewer THEN the app SHALL ask for confirmation, SHALL delete the image, and SHALL close the viewer with the grid updated.
    -   IF the delete request fails THEN the app SHALL show an error toast and SHALL keep the image visible.

R2. Multi-select enablement

-   User Story: As a user, I want to select multiple images and delete them in one action so I can clean up faster.
-   Acceptance Criteria:
    -   WHEN I toggle multi-select mode from the gallery toolbar THEN the grid SHALL display selection checkboxes (or equivalent affordances) for each image.
    -   WHEN I select or deselect thumbnails THEN the app SHALL keep accurate count of selected hashes and SHALL reflect the state in the toolbar.
    -   WHEN multi-select mode is disabled THEN the selection SHALL clear automatically.

R3. Bulk delete execution

-   User Story: As a user, I want a bulk delete action to remove all selected images at once.
-   Acceptance Criteria:
    -   WHEN I press Delete Selected AND confirm the prompt THEN the app SHALL soft-delete every selected hash in a single logical operation and SHALL remove those items from the grid without a full reload.
    -   IF any delete in the batch fails THEN the app SHALL show a consolidated error toast naming the failed items and SHALL keep them selected for retry.
    -   WHEN the bulk operation is in progress THEN the app SHALL show a busy indicator (spinner, disabled button, or similar) to prevent duplicate submissions.

R4. State synchronization and refresh

-   User Story: As a user, I expect the gallery list to stay accurate after deletions.
-   Acceptance Criteria:
    -   WHEN an image is deleted (single or bulk) THEN it SHALL be removed from the local gallery state immediately and SHALL not reappear on subsequent pagination requests.
    -   WHEN the user scrolls and triggers `loadMore` after deletions THEN the paging logic SHALL avoid returning deleted hashes (leveraging the existing `deleted !== true` filter).
    -   WHEN the viewer is open for an image that gets deleted via bulk action THEN the viewer SHALL close automatically with a notice explaining the deletion.

R5. Audit hooks and analytics

-   User Story: As an operator, I want deletions to fire existing hook pipelines for auditing.
-   Acceptance Criteria:
    -   WHEN images are deleted THEN the implementation SHALL continue using `useHooks` events (`db.files.delete:*`), ensuring integrations receive notifications.
    -   WHEN multiple hashes are deleted THEN the implementation SHALL invoke hooks per hash within a single transaction to preserve consistent metadata updates.

## Non-Functional Requirements

NFR1. Performance

-   Bulk delete SHALL operate in a single Dexie transaction when possible to minimize repainting and hook calls.
-   UI updates SHALL avoid triggering full gallery reloads; prefer local state reconciliation.

NFR2. Accessibility

-   Delete buttons and selection controls SHALL be keyboard focusable with descriptive labels.
-   Confirmation prompts SHALL announce the number of items affected.

NFR3. Error handling

-   All failures SHALL surface via the existing toast/error boundary system without leaving the UI in an inconsistent state.

NFR4. Safety

-   Deletions SHALL be soft only (no blob removal) to allow future restore workflows.
-   Confirmation prompts SHALL default to cancel to prevent accidental loss.

## Traceability

-   R1 → Single delete UI in `GalleryGrid` and `ImageViewer`.
-   R2 → Multi-select toggle, selection state management.
-   R3 → Bulk delete confirmation, progress, error handling.
-   R4 → State reconciliation, pagination consistency, viewer behavior.
-   R5 → Hook invocation for audit trail.
-   NFR1–NFR4 → Performance, accessibility, error visibility, and safety guarantees.
