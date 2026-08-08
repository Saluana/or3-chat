# useDocumentationToc

Table-of-contents helpers for rendered documentation pages. These are pure functions that inspect a rendered HTML element.

## Helpers

-   `slugifyHeading(text)` — turn heading text into an id (`"My Heading"` → `"my-heading"`).
-   `buildTocFromElement(root)` — scan `h1`–`h6` elements and return `{ toc, headingOffsets }`. Each item is `{ id, text, level }`. Duplicate ids get numeric suffixes, and missing ids are generated and written back to the element.
-   `getHeadingOffsets(root)` — map of element id to `offsetTop` for scroll-spy.

## Usage

```ts
import { buildTocFromElement } from '~/composables/documents/useDocumentationToc';

const { toc, headingOffsets } = buildTocFromElement(contentElement);
```

## Notes

-   Only elements with visible text produce entries.
-   `offsetTop` values are relative to the offset parent; measure after layout settles.

## Related

-   `useDocumentationContent` — the page being scanned.
