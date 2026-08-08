# useMessageMarkdown

Composable that prepares assistant message text for markdown rendering. It swaps `file-hash:` image references for placeholder URLs and exposes the current code-highlighting theme.

## Purpose

`useMessageMarkdown(message)` takes a reactive message and returns:

-   `assistantMarkdown` — the raw text for assistant messages, `''` otherwise.
-   `processedAssistantMarkdown` — the same text with `file-hash:` images replaced by a transparent placeholder pixel. The placeholder lets the UI measure layout before the real image loads. Output is memoized per input.
-   `currentShikiTheme` — the Shiki syntax theme name (`github-dark` or `github-light`) derived from the active app theme.

The standalone helper `processAssistantMarkdown(markdown)` performs the replacement without any Vue state. It is safe to call outside components.

## Usage

```ts
import { useMessageMarkdown } from '~/composables/chat/useMessageMarkdown';

const { processedAssistantMarkdown, currentShikiTheme } = useMessageMarkdown(
    messageRef // Ref<{ role: string; text?: string }>
);
```

Render `processedAssistantMarkdown.value` through your markdown component and pass `currentShikiTheme.value` to the code highlighter.

## Notes

-   Only assistant messages are processed; other roles return `''`.
-   The placeholder replacement avoids broken-image flicker for attachments that load lazily.

## Related

-   `useMessageThumbnails` — resolves the actual thumbnail URLs for attached files.
-   `~/utils/chat/imagePlaceholders` — the placeholder data URI.
