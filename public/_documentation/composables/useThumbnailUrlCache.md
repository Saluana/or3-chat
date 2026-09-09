# useThumbnailUrlCache

Shared cache for thumbnail object URLs. It deduplicates in-flight loads, tracks reference counts, and revokes blob URLs after a grace period so memory stays bounded.

## Purpose

`useThumbnailUrlCache({ graceMs })` returns:

-   `get(hash)` — current `ThumbState` for a hash, if any.
-   `ensure(hash, loader)` — return the cached state or load the blob via `loader()` and create an object URL. Concurrent calls for the same hash share one in-flight load.
-   `retain(hash)` — increment the reference count and cancel pending cleanup.
-   `release(hash)` — decrement the reference count; at zero, schedule cleanup after `graceMs` (default 30s).
-   `setIntrinsicSize(hash, width, height)` — record natural dimensions for layout.

`ThumbState` is `{ status: 'ready' | 'error', url?, width?, height? }`.

## Usage

```ts
import { useThumbnailUrlCache } from '~/composables/core/useThumbnailUrlCache';

const cache = useThumbnailUrlCache();

cache.retain(hash);
const state = await cache.ensure(hash, () => getFileBlob(hash));
// render state.url ...
cache.release(hash); // cleanup scheduled after the grace period
```

## Notes

-   The cache lives on `globalThis`, so every consumer shares it.
-   Blobs are verified as supported raster images before they become `ready` or
    reach the browser image decoder; decode failures become `error` states.
-   PDFs, SVGs, generic files, and forged raster MIME declarations produce an
    `error` state.
-   Nothing persists across reloads.

## Related

-   `useMessageThumbnails` — per-message consumer.
-   `useMessageMediaPrefetch` — bulk prefetch consumer.
