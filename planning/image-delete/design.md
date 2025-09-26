# Image Library Deletion — Design

Artifact ID: 9a4722f3-3b71-4d2a-8c43-6f4d8521ccfd

## Overview

Augment the existing `/images` experience with soft deletion capabilities. Users can delete a single image (from the grid or viewer) or select multiple thumbnails and remove them in one action. The design reuses the Dexie-backed file store, calling `softDeleteFile` (and a new batched helper) so hooks and reference counts continue to behave. UI changes are limited to `pages/images/index.vue`, `GalleryGrid.vue`, and `ImageViewer.vue`, plus a small selection toolbar for bulk operations.

## Architecture

### High-level flow

```mermaid
graph TD
    User[User] -->|Click Delete / Toggle Selection| Grid[GalleryGrid]
    Grid -->|emit('delete')| ImagesPage
    Grid -->|emit('select-change')| ImagesPage
    ImagesPage -->|invoke| FileRepo[files.ts]
    ImagesPage -->|updates| State[Local gallery state]
    FileRepo -->|soft delete + hooks| Dexie[(Dexie db.file_meta)]
    ImagesPage -->|emit('deleted')| Viewer[ImageViewer]
    Viewer -->|emit('delete')| ImagesPage
    ImagesPage -->|toast feedback| Notifications[Error/Success Toasts]
```

### Components & responsibilities

1. `pages/images/index.vue`
    - Holds gallery state, pagination, and new multi-select state (`selectedHashes`, `selectionMode`, `isDeleting`).
    - Provides deletion orchestration (`deleteOne`, `deleteMany`).
    - Surfaces confirmation prompts and success/error toasts.
2. `GalleryGrid.vue`
    - Renders checkboxes (or overlay badges) when `selectionMode === true`.
    - Emits `toggle-select`, `delete`, and reuses existing `view` / `download` / `copy` / `rename` events.
3. `ImageViewer.vue`
    - Adds a Delete button next to existing actions.
    - Emits `delete` and reacts to `deleted` event to auto-close if the displayed item disappears.
4. `files.ts`
    - Adds `softDeleteMany(hashes: string[]): Promise<void>` using a single Dexie transaction and hook events per hash.
    - Optionally exports a typed `DeleteError` to align with toast messaging.

## Interfaces & Contracts

```ts
export interface ImageDeletionController {
    selectionMode: Ref<boolean>;
    selected: Ref<Set<string>>;
    isDeleting: Ref<boolean>;
    toggleSelectionMode(): void;
    toggleHash(hash: string): void;
    clearSelection(): void;
    deleteSingle(meta: FileMeta): Promise<ServiceResult<void>>;
    deleteBulk(): Promise<ServiceResult<BulkDeleteSummary>>;
}

export interface BulkDeleteSummary {
    attempted: string[];
    succeeded: string[];
    failed: string[];
}

export type ServiceResult<T> =
    | { ok: true; data: T }
    | { ok: false; message: string; details?: unknown };

export async function softDeleteMany(hashes: string[]): Promise<void>;
```

The controller lives within `index.vue` (Composable optional). `ServiceResult` mirrors existing light-weight patterns in the repo (`utils/errors.ts`) without introducing new dependencies.

## Data Model Implications

No schema changes. Deletions still mark `db.file_meta.deleted = true` and update `updated_at`. `softDeleteMany` wraps `softDeleteFile` semantics but batches operations:

```ts
export async function softDeleteMany(hashes: string[]): Promise<void> {
    if (!hashes.length) return;
    const hooks = useHooks();
    await db.transaction('rw', db.file_meta, async () => {
        const metas = await db.file_meta.bulkGet(hashes);
        for (const meta of metas) {
            if (!meta || meta.deleted) continue;
            await hooks.doAction('db.files.delete:action:soft:before', meta);
            await db.file_meta.put({
                ...meta,
                deleted: true,
                updated_at: nowSec(),
            });
            await hooks.doAction(
                'db.files.delete:action:soft:after',
                meta.hash
            );
        }
    });
}
```

`listImageMetasPaged` already filters out `deleted === true`, so paging remains consistent.

## UI & Interaction Details

-   **Toolbar**: A new toolbar in `index.vue` shows when `items.length > 0` with controls: `Toggle multi-select`, `Delete selected (count)`, and `Clear`.
-   **Selection affordance**: Checkboxes overlay the top-left of each cell. Keyboard users can focus a tile and press space to toggle.
-   **Confirmation**: Use `useDialog()` (if available) or `window.confirm` fallback, with message: “Delete N image(s)? This cannot be undone.”
-   **Viewer delete**: Deletes active hash, clears it from `selected`, closes viewer, and ensures `selectionMode` turns off if zero selections remain.
-   **Loading feedback**: Disable delete controls while `isDeleting === true`; optionally show a spinner next to button text.

## Error Handling Strategy

-   Wrap delete calls with try/catch.
-   On failure, emit `reportError(err('ERR_DELETE_FAILED', ...))` and show toast via existing error pipeline.
-   Bulk failures gather per-hash errors into a single toast message.
-   Ensure `isDeleting` resets in finally blocks and selection remains for retry when failures occur.

## Testing Strategy

-   **Unit**: Test `softDeleteMany` to ensure multiple hashes mark `deleted` and hooks fire once per hash.
-   **Component**: Use Vitest + Vue Testing Library to verify:
    -   Toggling multi-select shows checkboxes and updates selected count.
    -   `Delete Selected` calls deletion helper and prunes grid items.
    -   Viewer delete triggers close.
-   **Integration**: Simulate pagination after deletions to confirm removed hashes do not reappear.
-   **Accessibility checks**: Snapshot keyboard tab order, ensure ARIA labels exist.
-   **Performance**: Measure bulk delete of 50 items to ensure completion under ~200ms (client-side Dexie).
