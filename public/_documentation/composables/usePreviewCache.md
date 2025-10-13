# usePreviewCache

In-memory LRU-ish cache for preview assets (images, PDFs, etc.). It wraps blob URL creation, tracks byte usage, exposes metrics, and handles eviction with pinning so priority previews stick around.

---

## What does it do?

`usePreviewCache` gives you a reusable cache instance that:

-   Normalises preview options via `resolvePreviewCacheOptions`
-   Provides `ensure()` to fetch or reuse cached URLs
-   Tracks hits/misses/evictions for telemetry
-   Supports pinning entries to avoid eviction while in view
-   Offers helpers to promote, release, drop, and flush entries

An additional `useSharedPreviewCache` exposes a singleton cache shared across the app.

---

## Basic Example

```ts
import { usePreviewCache } from '~/composables/core/usePreviewCache';

const cache = usePreviewCache({ maxUrls: 50, maxBytes: 50 * 1024 * 1024 });

const url = await cache.ensure('file:123', async () => {
    const blob = await fetchPreviewBlob();
    return { url: URL.createObjectURL(blob), bytes: blob.size };
});

img.src = url;
```

---

## How to use it

### 1. Create or grab the cache

```ts
const cache = useSharedPreviewCache();
// or
const cache = usePreviewCache({ maxUrls: 100, maxBytes: 80 * 1024 * 1024 });
```

### 2. Ensure previews exist

Call `ensure(key, loader, pin?)` to fetch or reuse a preview URL.

```ts
const url = await cache.ensure(hash, () => buildPreview(hash), 1);
```

### 3. Manage lifecycle

-   `promote(key)` when a preview becomes visible
-   `release(key)` when it scrolls off-screen
-   `drop(key)` or `flushAll()` to manually clear

### 4. Monitor usage

`cache.metrics()` reports counts and total bytes; `cache.logMetrics(stage)` dumps them to the console in dev builds.

---

## API

```ts
const cache = usePreviewCache(options?: Partial<PreviewCacheOptions>);
```

| Method          | Signature                                             | Description                                                                               |
| --------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ensure`        | `(key, loader, pin?) => Promise<string \| undefined>` | Return cached URL or call `loader()` to create one. Updates LRU data and enforces limits. |
| `promote`       | `(key, pin?) => void`                                 | Bump access counter and raise pin weight.                                                 |
| `release`       | `(key) => void`                                       | Lower pin count after a preview is no longer critical.                                    |
| `drop`          | `(key) => boolean`                                    | Remove a single entry and revoke the blob URL.                                            |
| `flushAll`      | `() => string[]`                                      | Remove every entry, returning the keys dropped.                                           |
| `evictIfNeeded` | `(stage?) => string[]`                                | Enforce `maxUrls`/`maxBytes`; returns evicted keys.                                       |
| `metrics`       | `() => PreviewCacheMetrics`                           | Snapshot of cache size, bytes, hits, misses, evictions.                                   |
| `logMetrics`    | `(stage) => void`                                     | Console log (dev only).                                                                   |
| `peek`          | `(key) => string \| undefined`                        | Read URL without mutating access counters.                                                |
| `options`       | `PreviewCacheOptions`                                 | Resolved options (max counts, etc.).                                                      |

`useSharedPreviewCache(overrides?)` returns a singleton instance; overrides only apply to the first call (later overrides warn in dev). `resetSharedPreviewCache()` flushes and clears the singleton reference.

---

## Under the hood

1. **Options resolution** — Merges partial overrides with defaults via `resolvePreviewCacheOptions`.
2. **Map storage** — Maintains a `Map<key, CacheEntry>` with metadata (`bytes`, `pin`, `lastAccess`).
3. **LRU eviction** — When limits are exceeded, entries sort by pin weight then `lastAccess`; unpinned, least-recent entries fall out first.
4. **Blob revocation** — `remove()` revokes object URLs via `URL.revokeObjectURL` to avoid leaks.
5. **Metrics** — Hits/misses/evictions counters increment inside `ensure()`/`evictIfNeeded()`; `metrics()` packages them for dashboards.

---

## Edge cases & tips

-   **Pinning**: `pin` is additive—pass higher numbers to make an item harder to evict (e.g., 2 for hero previews). Remember to `release`.
-   **Loader bytes**: If the loader omits `bytes`, the cache assumes `0`. Supplying the blob size keeps eviction accurate.
-   **Shared cache overrides**: Only the first call to `useSharedPreviewCache` respects overrides; later calls log a warning when options differ.
-   **Server-side rendering**: Safe to import, but loaders should guard against browser-only APIs (e.g., `URL.createObjectURL`).
-   **Diagnostics**: Call `logMetrics('stage-name')` in dev to trace eviction behavior.

---

## Related

-   `preview-cache` config (`~/config/preview-cache.ts`) — default limits and resolver.
-   `useWorkspaceBackup` — another heavy I/O composable that benefits from previews for status screens.
-   `useSharedPreviewCache` / `resetSharedPreviewCache` — exported alongside this composable for global cache reuse.
