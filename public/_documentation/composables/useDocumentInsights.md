# useDocumentInsights

Document metrics and outline computed from a live TipTap editor. It watches editor transactions and refreshes on a requestAnimationFrame budget.

## Purpose

`useDocumentInsights(editor)` takes a `Ref<Editor | null>` and returns:

-   `outline` — readonly list of heading items (`{ id, level, text, position }`) for levels 1–3.
-   `activeOutlineId` — readonly id of the heading containing the current selection.
-   `stats` — computed `{ words, characters, blocks, readingMinutes, serializedBytes }`.
-   `scrollTo(item)` — focus and scroll the editor to an outline item.
-   `setSerializedSize(size)` — report the serialized document size.
-   `refresh()` — force a recompute.

## Usage

```ts
import { useDocumentInsights } from '~/composables/documents/useDocumentInsights';

const insights = useDocumentInsights(editorRef);
```

## Notes

-   Recomputation is throttled to once per animation frame.
-   Listening is auto-attached/detached when the editor ref changes, and cleaned up on scope dispose.

## Related

-   `DocumentEditor.vue` — the editor host.
-   `useDocumentEditorToolbar` — commands for the same editor.
