# Image preview cache ownership

The image gallery and viewer share object URLs through
[usePreviewCache](../app/composables/core/usePreviewCache.ts).
This is a browser source integration, not a deployment environment setting.
It does not persist previews or automatically partition entries by workspace.

## Configure once

[preview-cache.ts](../app/config/preview-cache.ts) chooses these defaults:

| Reported device memory | URL cap | Byte cap |
| --- | --- | --- |
| At most 4 GB | 80 | 48 MiB |
| Above 4 GB or unavailable | 120 | 80 MiB |

Call `useSharedPreviewCache({ maxUrls, maxBytes })` before the first consumer
to customize them. Later overrides are ignored, with a development log when
they differ. These are eviction targets, not hard browser-memory limits:
pinned entries can keep the cache above either cap, and byte accounting uses
the loader's reported size rather than decoded-image memory.

## URL lifetime

`ensure(key, loader, pin)` shares an in-flight load or cache entry. The loader
must return a nonempty URL and should report its byte size. `ensure` and
`promote` raise the pin to the maximum of its current value and the requested
level; they do not increment a reference count on every call. `release`
decrements it toward zero.

`evictIfNeeded()` removes least-recently-used unpinned entries and returns
their keys so callers can remove stale UI bindings. `drop()` and `flushAll()`
revoke removed URLs even when pinned. They also cancel pending cache insertions;
a cancelled load revokes its eventual URL and can resolve to `undefined`.

[GalleryGrid](../app/pages/images/GalleryGrid.vue) pins visible previews at
level 1, releases off-screen entries, and flushes on tab hide/unmount. It keeps
visible hashes and reloads them on tab show because an intersection observer
may not report the same visible tiles again.
[ImageViewer](../app/pages/images/ImageViewer.vue) reuses the cache, promotes
the active image to level 2, and releases it when moving or closing.

Consumers must coordinate flushes and workspace changes, clear removed bindings,
and avoid independently revoking a shared URL still in use. Releasing a pin
alone does not immediately revoke the URL.

## Inspect behavior

`metrics()` reports URLs, accounted bytes, hits, misses, and evictions.
Development logs also show configured caps after removal/eviction/flush.
Check visibility changes, viewer close, workspace changes, cancelled loads,
and gallery unmount; measure decoded-image memory separately when profiling.
Image query and metadata rules are documented in
[Image library queries](../public/_documentation/database/files-select.md).
