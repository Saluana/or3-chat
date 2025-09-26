# Dashboard Image Library — Design

Artifact ID: 0bbfc1cc-998d-4cda-bdd8-33b5d63b3a2a

## Overview

A minimal `/images` dashboard page that lists all stored images (attachments and AI-generated) using the existing file storage APIs in `app/db/files.ts`. The page shows a paged gallery grid, a simple modal viewer, and per-item actions: View, Download, Copy, and Rename. Focus is on simplicity, performance, and minimal code.

## Architecture

### High-level Flow

-   Query images from local storage (Dexie) via a tiny DB selector that filters `db.file_meta` for images and not deleted.
-   Render a thumbnail grid (object URLs created from blobs on-demand when item enters viewport).
-   Click opens a modal viewer using the same blob object URL.
-   Actions:
    -   Download: Trigger browser download using object URL with file `name`.
    -   Copy: Use `navigator.clipboard.write(new ClipboardItem({ [mime]: blob }))` with fallback to data URL.
    -   Rename: Update `db.file_meta` record `name` and refresh the item state.

### Diagram

```mermaid
flowchart TD
  A[/Dexie db.file_meta\n(db.file_blobs)/] -->|list images| B[ListImages API]
  B --> C[ImagesPage (/images)]
  C --> D[GalleryGrid]
  D -->|click item| E[ImageViewer Modal]
  D -->|action| F[Download/Copy]
  D -->|rename| G[Rename (db update)]
  E -->|action| F
  E -->|rename| G
```

## Components

-   Page: `pages/images/index.vue`
    -   Fetches image metadata (paged) and renders `GalleryGrid`.
-   Component: `GalleryGrid.vue`
    -   Responsively lays out images using CSS grid. Emits `view`, `download`, `copy`, `rename` events.
-   Component: `ImageViewer.vue`
    -   Simple modal overlay showing selected image, with actions and keyboard close.

We will keep components local in the `pages/images/` folder to avoid over-structuring.

## Data Access

We reuse `app/db/files.ts` where possible and introduce a very small selector util that does not duplicate logic:

TypeScript pseudo-interface

```ts
// app/db/files.ts (existing)
export type { FileMeta };
export async function getFileMeta(hash: string): Promise<FileMeta | undefined>;
export async function getFileBlob(hash: string): Promise<Blob | undefined>;
```

New minimal selector (client-only):

```ts
// app/db/files-select.ts (new)
import { db } from './client';
import type { FileMeta } from './schema';

export async function listImageMetasPaged(
    offset = 0,
    limit = 50
): Promise<FileMeta[]> {
    return db.file_meta
        .where('deleted')
        .notEqual(true)
        .and((m) => m.kind === 'image' || m.mime_type?.startsWith('image/'))
        .reverse()
        .sortBy('updated_at')
        .then((arr) => arr.slice(offset, offset + limit));
}

export async function updateFileName(
    hash: string,
    name: string
): Promise<void> {
    const meta = await db.file_meta.get(hash);
    if (!meta) return;
    await db.file_meta.put({
        ...meta,
        name,
        updated_at: Math.floor(Date.now() / 1000),
    });
}
```

Notes:

-   We avoid adding new abstractions; just a minimal paging helper and rename helper using Dexie directly to match existing code style.
-   We keep paging client-side since storage is local.

## Interfaces

Key data shape from existing schema (approximate):

```ts
interface FileMeta {
    hash: string;
    name: string;
    mime_type: string;
    kind: 'image' | 'pdf' | string;
    size_bytes: number;
    width?: number;
    height?: number;
    page_count?: number;
    ref_count: number;
    deleted?: boolean;
    updated_at: number; // seconds
}
```

Gallery item contract

-   Input: `FileMeta`.
-   Derived: thumbnail object URL created lazily from `getFileBlob(meta.hash)`.
-   Actions: `onView(meta)`, `onDownload(meta)`, `onCopy(meta)`, `onRename(meta, newName)`.

## Behavior and Performance

-   Thumbnails: Fetch blobs only for items near viewport; cache object URLs per-session and revoke on component unmount.
-   Aspect boxes: Use `meta.width/meta.height` to set `aspect-ratio` style; fallback to square.
-   Paging: Default 50; simple “Load more” button to append next chunk.

## Error Handling

Use existing `utils/errors` `reportError` if available; otherwise show UI toasts via `components/ErrorToasts.vue` mechanism.

ServiceResult pattern

```ts
type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: Error };
```

Examples

-   Blob fetch error: show toast "Could not load image"; keep item displayed.
-   Copy not supported: show toast with fallback attempt; if both fail, explain limitations.
-   Rename conflict: not applicable; names are local labels, allow duplicates.

## Testing Strategy

-   Unit: small tests for `files-select.ts` paging filter and rename update.
-   Integration: mount gallery page, simulate load more, open modal, perform actions using mocked Dexie.
-   E2E (optional): open `/images`, check grid count, open viewer, download triggers.
-   Performance: quick smoke to ensure first render does not fetch all blobs; only metas.

## Security & Permissions

-   Local app context; no external requests. Clipboard access requires user gesture.

## Open Questions (de-scoped for minimal v1)

-   Thumbnail generation/caching beyond object URLs. For simplicity we use original image in scaled `<img>`.
-   Deletion. Not part of current scope.
