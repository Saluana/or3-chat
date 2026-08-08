# useDocumentationContent

Loader for documentation markdown pages. It fetches `/_documentation/<slug>.md` files for the `/documentation` routes.

## Purpose

`useDocumentationContent(routePath, contentOverride)` returns:

-   `fetchedContent` — raw markdown from the file fetch.
-   `pending` — fetch in progress flag.
-   `error` — fetch error.
-   `currentContent` — fetched content, or a "Page Not Found" stub on error.
-   `displayContent` — `contentOverride` when set, otherwise `currentContent`.

The route path is mapped to a markdown file: `/documentation/composables/useChat` becomes `/_documentation/composables/useChat.md`. Unknown routes resolve to an empty string or the not-found stub.

## Usage

```ts
import { useDocumentationContent } from '~/composables/documents/useDocumentationContent';

const { displayContent, pending } = useDocumentationContent(
    routePathRef,
    contentOverrideRef
);
```

## Notes

-   The overview page is bundled with the server build for instant SSR.
-   On the client, missing content triggers a fallback refetch after mount.

## Related

-   `useDocumentationNavigation` — the sidebar navigation for these pages.
-   `useDocumentationToc` — heading table of contents.
