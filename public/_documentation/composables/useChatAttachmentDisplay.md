# useChatAttachmentDisplay

Helper composable that prepares chat input attachments for rendering. It takes the raw attachment list and splits it into image and PDF buckets with stable display indexes.

## Purpose

`useChatAttachmentDisplay(attachments)` turns a flat list of uploaded files into ready-to-render groups:

-   `imageAttachments` — image entries with a `displayIndex` for gallery rendering.
-   `pdfAttachments` — PDF entries for the PDF chip list.

Every entry also receives an `index` and a stable `key`. The key falls back to the attachment hash, then the URL, then the index plus name.

## Usage

```ts
import { useChatAttachmentDisplay } from '~/composables/chat/useChatAttachmentDisplay';

const { imageAttachments, pdfAttachments } = useChatAttachmentDisplay(
    attachmentsRef // Ref<UploadedImage[]>
);
```

Bind `imageAttachments` to your image strip and `pdfAttachments` to your file chip list. Both are computed refs, so they update when attachments change.

## API

| Member              | Type                  | Description                                              |
| ------------------- | --------------------- | -------------------------------------------------------- |
| `imageAttachments`  | `ComputedRef<...[]>`  | Image attachments, each with `displayIndex`.             |
| `pdfAttachments`    | `ComputedRef<...[]>`  | PDF attachments in original order.                       |

## Notes

-   The composable is stateless. It never mutates the input list.
-   Attachment `kind` decides the bucket. Unknown kinds are ignored by both buckets.

## Related

-   `ChatInputDropper.vue` — the chat input that owns the raw attachment list.
-   `useChatInputTheme` — theme props for the same input surface.
