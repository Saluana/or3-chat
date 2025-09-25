# Image Library Deletion — Tasks

Artifact ID: 1c4b567e-6730-4dfd-97ab-39e0c8409fa5

Status: Draft (all tasks unchecked)

## 1. Data layer utilities

-   [x] 1.1 Add `softDeleteMany` helper in `app/db/files.ts`
    -   Transactionally mark multiple hashes as `deleted = true` and fire hooks per hash.
    -   Requirements: R3, R5, NFR1, NFR4
-   [x] 1.2 Export typed error helper (optional) or reuse existing `err()` variants for deletion failures.

    -   Requirements: R3, NFR3

-   [x] 2.1 Introduce `selectionMode`, `selectedHashes`, and `isDeleting` refs; persist across pagination updates.
    -   Requirements: R2, R3, R4, NFR1
-   [x] 2.2 Render a toolbar with toggle/clear/delete controls, showing selected count and disabled states during deletion.
    -   Requirements: R2, R3, NFR2
-   [x] 2.3 Implement `toggleSelect(hash)`, `clearSelection()`, `deleteSingle(meta)`, and `deleteSelected()` methods.
    -   Requirements: R1, R2, R3, R4
-   [x] 2.4 Integrate confirmation prompts (count-aware message) and toast notifications for success/failure.
    -   Requirements: R1, R3, NFR3, NFR4

## 3. Gallery grid updates (`GalleryGrid.vue`)

-   [x] 3.1 Accept new props: `selectionMode`, `selectedHashes`, `isDeleting`.
    -   Requirements: R2, NFR2
-   [x] 3.2 Render selection checkboxes/overlays; emit `toggle-select` and `delete` events per item.
    -   Requirements: R1, R2
-   [x] 3.3 Ensure keyboard navigation and ARIA labels for selection controls.
    -   Requirements: R2, NFR2

## 4. Image viewer enhancements (`ImageViewer.vue`)

-   [x] 4.1 Add a Delete button next to existing actions; emit `delete` event.
    -   Requirements: R1, NFR2
-   [ ] 4.2 Handle external deletion (prop change) by auto-closing and showing contextual notice.
    -   Requirements: R4, NFR3

## 5. Feedback & resiliency

-   [x] 5.1 Wire error handling through `reportError`/toasts for single and bulk operations.
    -   Requirements: R1, R3, NFR3
-   [x] 5.2 Maintain selection state after partial failures, highlighting items still present.
    -   Requirements: R3, R4

## 6. Testing & QA

-   [x] 6.1 Unit tests for `softDeleteMany` (success, noop when already deleted, partial missing hashes).
    -   Requirements: R3, R5, NFR1
-   [ ] 6.2 Component tests for multi-select UI (toggle mode, select, delete calls, viewer auto-close).
    -   Requirements: R1, R2, R3, R4
-   [ ] 6.3 Accessibility review: keyboard flow, focus states, confirm dialog messaging.
    -   Requirements: NFR2, NFR3

## Dependencies & sequencing

-   Blocker: Task 1.1 must complete before Tasks 2.3 / 3.2 / 4.1 integrate deletion flows.
-   Task 2.4 (confirmation + toast) depends on 2.3 (methods).
-   Testing tasks (section 6) follow implementation of corresponding features.
