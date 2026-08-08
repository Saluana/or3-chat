# useMessageThumbnails

Composable that resolves thumbnail URLs for attachments on a single message. It loads image blobs on demand, tracks PDF metadata, and supports an expand/collapse toggle for many attachments.

## Purpose

`useMessageThumbnails(message)` watches a message's `file_hashes` and produces:

-   `hashList` — parsed attachment hashes.
-   `thumbnails` — reactive map of hash to thumb state (`loading`, `ready`, or `error`, with `url`/dimensions when ready).
-   `pdfMeta` — reactive map of hash to PDF name and kind.
-   `displayedHashes` — the first `maxDisplayedThumbs` (4) hashes for the collapsed strip.
-   `getAttachmentName(hash)` — display name for an attachment (falls back to `Document`).
-   `expanded` / `toggleExpanded()` — state for expanding the full attachment list. The expanded flag is written back to `message._expanded`.

Blobs load through the shared thumbnail URL cache, so the same hash is fetched once app-wide.

## Usage

```vue
<script setup lang="ts">
import { useMessageThumbnails } from '~/composables/chat/useMessageThumbnails';

const { thumbnails, displayedHashes, expanded, toggleExpanded } =
    useMessageThumbnails(messageRef);
</script>

<template>
    <img
        v-for="hash in displayedHashes"
        :key="hash"
        :src="thumbnails[hash]?.url"
        v-show="thumbnails[hash]?.status === 'ready'"
    />
</template>
```

## Notes

-   Thumbnail references are retained while the component is mounted and released on unmount.
-   PDF blobs are detected by MIME type or file kind; their blobs are not turned into image URLs.

## Related

-   `useThumbnailUrlCache` — shared blob URL cache with ref counting.
-   `useMessageMediaPrefetch` — bulk prefetching for virtualized lists.
