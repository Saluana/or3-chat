# useMessageMediaPrefetch

Controller that warms image blobs for a virtual window of messages without mounting their rows. It keeps resources retained while their hashes stay inside the latest range, and releases them when they leave.

## Purpose

`createMessageMediaPrefetchController(options?)` returns a small controller for prefetching message attachments ahead of the visible area:

-   `updateRange(messages, range)` — declare the window of message indexes to prefetch. Parses `file_hashes`, retains new hashes, releases stale ones, and queues image loads.
-   `reset()` — cancel queued work and release every retained hash.
-   `dispose()` — reset and mark the controller as finished.
-   `whenIdle()` — resolves once no loads are queued or in flight.

Loading is bounded by `concurrency` (default 4). Non-image metadata is skipped. Loaded blobs are stored in the thumbnail URL cache.

## Options

```ts
createMessageMediaPrefetchController({
    concurrency?: number; // default 4
    cache?: ThumbnailCache; // defaults to useThumbnailUrlCache({ graceMs: 30_000 })
    loadMeta?: (hash) => Promise<...>; // defaults to getFileMeta
    loadBlob?: (hash) => Promise<Blob | undefined>; // defaults to getFileBlob
});
```

## Usage

```ts
import { createMessageMediaPrefetchController } from '~/composables/chat/useMessageMediaPrefetch';

const prefetch = createMessageMediaPrefetchController();
prefetch.updateRange(messages.value, { startIndex: 5, endIndex: 15 });

// When the viewport moves:
prefetch.updateRange(messages.value, { startIndex: 12, endIndex: 22 });

// On teardown:
prefetch.dispose();
```

## Notes

-   Runs entirely on the client; Dexie is the data source.
-   Stale epochs discard out-of-date work, so fast scrolling stays correct.

## Related

-   `useThumbnailUrlCache` — the shared cache used to store and release blob URLs.
-   `useMessageThumbnails` — per-message thumbnail rendering.
