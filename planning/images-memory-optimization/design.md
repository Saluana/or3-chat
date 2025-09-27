# Design: Images Grid Memory Optimization

artifact_id: 7b5b3d8e-b813-4f93-b134-4bb3c1bc3d26

## Overview

Introduce a small preview cache manager that enforces memory ceilings, shares blob URLs between `GalleryGrid.vue` and `ImageViewer.vue`, and exposes a couple of tuning hooks for low-memory devices. No backend or schema changes are required.

## Architecture

```mermaid
flowchart TD
    ImagesPage[pages/images/index.vue]
    Grid[GalleryGrid.vue]
    Viewer[ImageViewer.vue]
    Cache[PreviewCache]

    ImagesPage --> Grid
    Grid -->|ensurePreview(hash)| Cache
    Viewer -->|requestPreview(hash)| Cache
    Cache -->|blob fetch| FileStore[(IndexedDB)]
```

### Components

-   **PreviewCache (new composable)**

    -   Tracks previews in `Map<string, CacheEntry>` with LRU metadata and total bytes.
    -   Exposes `ensure(hash, loader)`, `promote(hash)`, `release(hash)`, `evict(limit)`, and `flushAll()`.
    -   Maintains counters for hits, misses, evictions for telemetry.

-   **GalleryGrid.vue (updated)**

    -   Replaces local map with shared `PreviewCache` instance.
    -   On visibility changes, calls `cache.evict()` using viewport-aware list of hashes.
    -   Subscribes to document visibility to trigger `cache.flushAll()` when hidden.

-   **ImageViewer.vue (updated)**
    -   Requests previews via `cache.ensure()` instead of calling `getFileBlob` directly.
    -   Calls `cache.promote()` while open and `cache.release()` on close.

## Data Model

```ts
type CacheTier = 'hot' | 'warm';

interface CacheEntry {
    url: string;
    bytes: number;
    tier: CacheTier;
    lastAccess: number;
}

interface PreviewCacheOptions {
    maxUrls: number;
    maxBytes: number;
}

interface PreviewCacheMetrics {
    urls: number;
    bytes: number;
    evictions: number;
    hits: number;
    misses: number;
}
```

## Key Flows

1. **Ensure preview**

    - `ensure` checks map; on miss, calls loader, records `bytes`, and promotes to hot tier.
    - After insert, `evictIfNeeded()` revokes oldest warm entries until limits satisfied.

2. **Viewport eviction**

    - `GalleryGrid` passes hashes currently visible; cache demotes others to warm.
    - Idle callback revokes warm entries beyond screen budget (e.g., last 3 screens).

3. **Viewer handoff**
    - `ImageViewer` calls `cache.promote(hash)` on open, keeping preview hot.
    - On close, `cache.release(hash)` toggles to warm, allowing later eviction.

## Error Handling

-   Blob fetch failures bubble through `reportError` (code `ERR_DB_READ_FAILED`).
-   URL revocation wrapped in try/catch; failures logged with tag `stage: 'evict'`.
-   Cache methods always resolve; they never throw when eviction cannot keep limits (they log and continue).

## Testing

-   **Unit**

    -   Cache: hits/misses, byte counting, LRU eviction, flush on visibility change.
    -   Grid: simulated scroll ensures stale hashes trigger `cache.evict()`.
    -   Viewer: reuse existing URL and no double fetch.

-   **Component (Vitest)**

    -   Mount grid + viewer together, open/close viewer, ensure preview count stays below cap.

-   **Manual**
    -   Devtools log snapshot after scrolling 500 images to confirm capped usage.
