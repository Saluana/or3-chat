# Images Preview Cache

The dashboard image flow relies on a shared preview cache so gallery tiles and the fullscreen viewer reuse blob URLs without leaking memory. This document explains the knobs that operators can tweak and the telemetry available while developing.

## Configuration entry point

-   `app/config/preview-cache.ts` exports `resolvePreviewCacheOptions` and `DEFAULT_PREVIEW_CACHE_OPTIONS`.
-   The resolver selects lower caps on devices that report `navigator.deviceMemory ≤ 4`.
-   Override caps once by calling `useSharedPreviewCache({ maxUrls, maxBytes })` **before** any component requests previews.

### Recommended caps

| Device memory | `maxUrls` | `maxBytes` |
| ------------- | --------- | ---------- |
| ≤ 4 GB        | `80`      | `48 MiB`   |
| > 4 GB        | `120`     | `80 MiB`   |

Adjust these values conservatively; the cache revokes URLs immediately on eviction, so pushing limits too high can cause Chrome/Firefox to recycle blob URLs under pressure.

## Runtime behaviour

-   `ensure(hash, loader, pin)` loads a blob on cache miss and attaches a pin. Visible tiles pass `pin = 1`; the viewer promotes to `pin = 2` while open.
-   `release(hash)` decrements the pin so future evictions can reclaim memory once off-screen.
-   `drop(hash)` removes a preview immediately and revokes the object URL.
-   `flushAll()` clears every entry (used when the tab becomes hidden or the grid unmounts).

## Dev logging & metrics

When `import.meta.dev` is true the cache prints a summary after:

-   `drop` (manual removal)
-   `evictIfNeeded` (LRU enforcement)
-   `flushAll` (visibility change / route leave)

Each log includes `urls`, `bytes`, `hits`, `misses`, `evictions`, `maxUrls`, and `maxBytes`. These numbers also surface through the `metrics()` accessor for downstream tooling.

## Integration checklist

-   `GalleryGrid.vue` pins visible previews, calls `evictIfNeeded()` after observer updates, and flushes on `visibilitychange`.
-   `ImageViewer.vue` reuses cached URLs, promotes on open, and releases on close.
-   Tests covering cache hit/miss/eviction live under `app/composables/__tests__/previewCache.test.ts` and `app/pages/images/__tests__/image-viewer.cache.test.ts`.

For manual verification, load ~500 images in development, run the browser memory profiler, and confirm the cache settles under the configured caps after idle eviction.
