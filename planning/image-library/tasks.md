# Dashboard Image Library — Tasks

Artifact ID: dc958c7d-6562-47f4-9f44-92761c875e1a

Status: Draft (all tasks unchecked)

## 1. Minimal data selectors (client-only)

-   [x] 1.1 Create `app/db/files-select.ts` with `listImageMetasPaged(offset, limit)`
    -   Filter: `deleted !== true` AND (`kind === 'image'` OR `mime_type?.startsWith('image/')`)
    -   Sort by `updated_at` desc; slice `[offset, offset+limit)`
    -   Requirements: R1, NFR2
-   [x] 1.2 Add `updateFileName(hash, name)` to `files-select.ts`
    -   Update `db.file_meta` name and `updated_at`
    -   Requirements: R4

## 2. Page and components

-   [x] 2.1 Add `pages/images/index.vue`
    -   Loads first page (limit 50), keeps `offset`, shows “Load more”
    -   Holds selected item for viewer; wires actions
    -   Requirements: R1, R2, NFR1
-   [x] 2.2 Implement local `GalleryGrid` inside the page (or `pages/images/GalleryGrid.vue`)
    -   CSS grid, aspect-ratio from metadata; placeholder on error
    -   Lazily resolve blob and create object URLs on visibility; revoke on unmount
    -   Emits: `view`, `download`, `copy`, `rename`
    -   Requirements: R1, R2, R3, R4, NFR2
-   [x] 2.3 Implement local `ImageViewer` modal (or `pages/images/ImageViewer.vue`)
    -   Full image preview, duplicate actions, ESC/backdrop/close button; focus trap
    -   Requirements: R2, R3, R4, NFR3

## 3. Actions

-   [x] 3.1 Download
    -   Use `getFileBlob(hash)` -> object URL -> temporary `<a download>` -> revoke URL
    -   Requirements: R3
-   [x] 3.2 Copy to clipboard
    -   Try `navigator.clipboard.write([new ClipboardItem({ [mime]: blob })])`
    -   Fallback: data URL -> `navigator.clipboard.writeText`
    -   Requirements: R3
-   [x] 3.3 Rename
    -   Prompt/in-place input -> `updateFileName`; optimistic UI; rollback on error
    -   Requirements: R4, NFR4

## 4. Error handling and toasts

-   [ ] 4.1 Surface errors via existing toasts (`components/ErrorToasts.vue`) or `reportError`
    -   Blob load, copy, rename
    -   Requirements: NFR4

## 5. Testing

-   [ ] 5.1 Unit tests for `files-select.ts`
    -   Filters & paging; rename timestamp bump
    -   Requirements: R1, R4
-   [ ] 5.2 Integration tests for page/components (vitest + nuxt)
    -   Load page, load more, open viewer, actions callable, rename flow happy/error
    -   Requirements: R1, R2, R3, R4
-   [ ] 5.3 Optional manual/E2E
    -   Open `/images`, scroll/paging, viewer open/close, copy & download

## 6. Accessibility and performance polish

-   [ ] 6.1 Keyboard support & ARIA labels; focus trap in modal; ESC to close
    -   Requirements: NFR3
-   [ ] 6.2 Ensure blobs are fetched lazily; revoke object URLs; avoid memory leaks
    -   Requirements: NFR2

## Dependencies

-   Existing: `app/db/files.ts` (`getFileBlob`, metadata types). No server changes.
-   New (local only): `app/db/files-select.ts` small helper.

## Out of Scope (for v1)

-   Delete images, tag management, global search.
