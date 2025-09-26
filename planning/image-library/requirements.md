# Dashboard Image Library — Requirements

Artifact ID: 3b2a6d2a-1d1e-4d3f-a5e9-1f8b8e5c3b8a

## Introduction

Create a simple, fast image library page in the dashboard that displays all images saved by the app (attachments and AI-generated), with the ability to view, download/copy, and rename images. Minimize new code by leveraging existing storage primitives in `app/db/files.ts` and keeping the UI lightweight.

## Investigation Summary

-   Storage: `app/db/files.ts` manages file storage via two Dexie tables (inferred): `db.file_meta` (metadata) and `db.file_blobs` (binary). Key APIs:
    -   `createOrRefFile(file: Blob, name: string): Promise<FileMeta>` stores or references by content hash, infers basic image dimensions, sets `kind` (`'image'` or `'pdf'`).
    -   `getFileMeta(hash: string): Promise<FileMeta | undefined>` returns metadata.
    -   `getFileBlob(hash: string): Promise<Blob | undefined>` returns binary blob.
    -   `softDeleteFile(hash: string)` marks deleted; `derefFile(hash)` changes ref count.
-   Helpers: `app/utils/chat/files.ts` has small utilities:
    -   `dataUrlToBlob(dataUrl: string): Blob | null`
    -   `inferMimeFromUrl(u: string, provided?: string) => string`
-   Image identification: metadata has `mime_type` and `kind`; choose items where `deleted !== true` AND (`mime_type` starts with `image/` OR `kind === 'image'`).

## Scope

-   One new dashboard page at `/images` with a gallery grid.
-   Minimal modal viewer for full-size image and actions.
-   Actions per image: View, Download, Copy to clipboard, Rename.

## Functional Requirements

R1. Image Gallery Grid

-   User Story: As a user, I want a gallery of all saved images so I can browse them.
-   Acceptance Criteria:
    -   WHEN I open `/images` THEN the app SHALL list images where `deleted = false` and `mime_type` starts with `image/` (or `kind = 'image'`).
    -   WHEN images are displayed THEN they SHALL be ordered by `updated_at` descending.
    -   WHEN there are more than N images (default N = 50) THEN the page SHALL support loading additional pages on demand.
    -   IF an image blob cannot be loaded THEN a placeholder SHALL be shown and the item remains listed.

R2. Click to View Full Image

-   User Story: As a user, I want to click a thumbnail to view the image larger so I can inspect details.
-   Acceptance Criteria:
    -   WHEN I click a gallery item THEN a modal viewer SHALL open showing the full-size image.
    -   WHEN the viewer is open THEN I SHALL be able to close it via ESC, backdrop click, or a close button.
    -   IF `width`/`height` metadata exists THEN the viewer SHALL use it to reserve aspect ratio space to reduce layout shift.

R3. Download and Copy Image

-   User Story: As a user, I want to download or copy an image so I can use it elsewhere.
-   Acceptance Criteria:
    -   WHEN I trigger Download THEN the image SHALL download with the stored `name` and a correct file extension if present.
    -   WHEN I trigger Copy THEN the app SHALL attempt `navigator.clipboard.write` using `ClipboardItem` with `image/*`; IF unsupported THEN it SHALL fall back to copying a data URL.
    -   IF blob retrieval fails for either action THEN an error toast SHALL be shown.

R4. Rename Image

-   User Story: As a user, I want to rename an image to keep my library organized.
-   Acceptance Criteria:
    -   WHEN I choose Rename THEN I SHALL be able to input a new `name` inline or via a small prompt.
    -   WHEN I confirm rename THEN the new name SHALL persist to `db.file_meta` and update in the UI without a full page reload.
    -   IF persistence fails THEN an error toast SHALL be shown and the previous name SHALL be restored.

## Non-Functional Requirements

NFR1. Simplicity and Minimal Code

-   Single new page (`/images`) plus a small modal; reuse existing storage APIs in `app/db/files.ts`.

NFR2. Performance and Memory

-   Page results in batches (e.g., 50) to limit initial load.
-   Use `URL.createObjectURL` for previews; revoke object URLs on unmount/close.
-   Prefer `width`/`height` metadata to minimize CLS.

NFR3. Accessibility

-   Keyboard accessible viewer (open/close, focus trap) and labeled buttons.

NFR4. Error Handling

-   All failures (blob fetch, copy, rename) SHALL surface a user-visible toast and not crash the UI.

## Traceability

-   R1: Gallery listing, order, paging.
-   R2: Modal viewer open/close, aspect ratio handling.
-   R3: Download/copy with fallback, error toasts.
-   R4: Rename persistence and live UI update.
-   NFR1–NFR4: Simplicity, performance, accessibility, resilience.
