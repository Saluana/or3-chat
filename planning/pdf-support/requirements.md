# requirements.md

artifact_id: 4c0a6d0b-0d4a-4f35-8f6e-6b3f9c1e9d11

## 1. Introduction

Add minimal client‑side PDF attachment support to chat. Users can drop, paste, or pick PDF files similar to images. PDFs are stored locally (same persistence path as images) encoded as base64 data URLs and included in model requests via OpenRouter's `file` content type. Thumbnails display with a simple placeholder (icon + filename + page count if detectable later; initial implementation uses only filename). Keep scope narrow: no OCR, no server processing, no pagination preview. Implementation mirrors existing image pipeline with minimal branching by MIME type.

## 2. User Stories & Acceptance Criteria

### 2.1 Attach PDF via File Picker / Drag & Drop

As a user, I want to attach a PDF by choosing it or dragging it into the input so I can ask questions about its content.
Acceptance Criteria:

-   WHEN user drags a PDF over input THEN drop zone highlight SHALL appear (same style as images).
-   WHEN user drops or selects a `.pdf` file THEN it SHALL appear in attachments grid with a PDF placeholder thumbnail.
-   IF max attachment limit is reached (existing `MAX_FILES_PER_MESSAGE`) THEN additional PDFs SHALL be ignored.

### 2.2 Paste PDF (Clipboard) (Optional / Best Effort)

As a user, I want pasted clipboard PDF files recognized like dragged ones.
Acceptance Criteria:

-   IF clipboard item has MIME `application/pdf` THEN system SHALL create a PDF attachment (base64 data URL) and prevent default text insertion.
-   IF paste has no PDF items THEN behavior SHALL remain unchanged.

### 2.3 PDF Thumbnail Representation

As a user, I want a clear visual differentiation of PDFs from images.
Acceptance Criteria:

-   PDF attachments SHALL render a square tile with: PDF label badge (e.g., "PDF"), truncated filename, and a remove button identical to images.
-   Thumbnail SHALL NOT attempt to render actual PDF page content (placeholder only) in this iteration.

### 2.4 Remove PDF Attachment

As a user, I want to remove an attached PDF prior to sending.
Acceptance Criteria:

-   WHEN user clicks remove on a PDF tile THEN it SHALL be removed from local attachments state.

### 2.5 Send Chat With PDFs

As a user, I want PDFs sent to the model along with text/images.
Acceptance Criteria:

-   WHEN user clicks Send AND at least one PDF is attached THEN each PDF SHALL be present in the emitted payload in `files`/`images` equivalent collection (extended to support PDFs) with fields: name, mime, base64 data URL, hash/meta (if persistence returns one).
-   Payload to OpenRouter layer SHALL include PDF objects as `{ type: 'file', file: { filename, file_data: dataUrl } }`.

### 2.6 Persistence & Reuse

As a user, I expect consistent behavior with images regarding persistence.
Acceptance Criteria:

-   PDF persistence SHALL reuse `createOrRefFile` (or analogous) without schema change.
-   Hash deduplication logic SHALL function identically (if same file reattached, referencing existing meta is allowed).

### 2.7 Error Handling

As a user, I want graceful handling of invalid PDFs.
Acceptance Criteria:

-   IF file MIME isn't `application/pdf` while extension is `.pdf` THEN attachment SHALL be rejected with console warning (silent UI ignore acceptable for MVP).
-   IF read or persistence fails THEN tile status SHALL show error style (reuse image error pattern) and sending SHALL still proceed excluding errored PDFs.

### 2.8 Non-Functional (Simplicity & Performance)

Acceptance Criteria:

-   Implementation SHALL add ≤ ~80 lines net across modified files (target; not enforced strictly if clarity requires slightly more).
-   No new dependencies SHALL be added.
-   No additional render loops or watchers beyond those already used for images.

## 3. Out of Scope

-   Rendering first page preview.
-   Extracting text client-side.
-   Multi-page navigation or PDF pagination UI.
-   Cost optimization via annotations reuse (future server integration).

## 4. Assumptions

-   Current image pipeline uses base64 previews and `createOrRefFile` for storage; extending same is simplest.
-   OpenRouter consumer code already transforms image attachments into `file` content entries; small adjustment will generalize to PDFs.
-   Attachment grid component logic can branch by MIME type with conditional template block.

## 5. Glossary

-   PDF Placeholder: Styled square tile with badge and filename.
-   Data URL: `data:application/pdf;base64,<encoded>` string used in OpenRouter payload.
