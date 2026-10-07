# Build provider messages

`buildOpenRouterMessages` translates OR3 chat content into provider messages. It hydrates attachments, applies image-history policies, and preserves tool-call metadata. It does not choose a model, decide output modalities, authenticate, or send a request.

This is a browser-side host utility: local file hydration uses IndexedDB and FileReader. Portable plugins should use [SDK model calls](/documentation/plugins/plugin-sdk).

## Build a text request payload

```ts
import {
  buildOpenRouterMessages,
  AttachmentHydrationError,
  type ORMessage,
} from '~/core/auth/openrouter-build';
import type { ChatMessage } from '~/utils/chat/types';

export async function prepareMessages(history: ChatMessage[]): Promise<ORMessage[]> {
  try {
    return await buildOpenRouterMessages(history, {
      imageInclusionPolicy: 'recent-user',
      recentWindow: 12,
      maxImageInputs: 4,
      dedupeImages: true,
    });
  } catch (error) {
    if (error instanceof AttachmentHydrationError) {
      // Show this safe message in the existing request error UI.
      throw new Error(error.message);
    }
    throw error;
  }
}
```

Use the existing chat request flow to send the result. A direct fetch example would omit the host's credential routing, authorization, limits, and error handling.

## Input and output

Input messages have a role of `user`, `assistant`, `system`, or `tool`, and string content or internal content parts. Text parts become provider text; internal image parts become `image_url`; internal file parts become `file` with `filename` and `file_data`. The result is `ORMessage[]` whose `content` is a part array. Nonempty `tool_calls` are copied only for assistant messages; `tool_call_id` and `name` are copied when present.

Canonical history projection restores completed embedded tool results, including validated nested transcript results, as transient tool messages when no durable result row exists. This keeps call/result pairs complete on follow-up requests without modifying saved history or duplicating durable results.

Stored `file_hashes` is a **JSON-serialized array**, not a space-separated or comma-separated string. Use `serializeFileHashes` from `~/db/files-util`, or the [message-file helpers](/documentation/database/message-files), when constructing it. The builder also accepts binary image/file content; views respect their byte offsets.

## Image options

| Option | Default | Behavior |
| --- | --- | --- |
| `maxImageInputs` | 8 | Maximum selected image candidates across history, keeping the newest after dedupe; zero excludes image candidates. Explicit file parts remain. |
| `dedupeImages` | true | Keeps the first occurrence of a reference. |
| `acceptsImageInput` | true | `false` replaces each message's images with a short text note, for a model whose catalog input modalities lack `image`. |
| `imageInclusionPolicy` | `all` | `all`, `recent`, `recent-user`, or `recent-assistant`. |
| `recentWindow` | 12 | The last N messages in the entire history, then role filtering for the role-specific policies. It is not the last N messages of that role. |
| `filterIncludeImages` | none | Optional synchronous or async callback over candidates before final selection. |
| `debug` | false | Accepted option; current implementation suppresses debug logging. |

A `BuildImageCandidate` has `hash`, `role`, and `messageIndex`. Policies apply to image candidates, not to ordinary file parts. Image count limiting is not token budgeting. Native chat passes `acceptsImageInput: false` only when the selected model's catalog entry lists input modalities without `image`; unknown metadata keeps images. A new image attached for such a model is refused before any write with reason `unsupported_input`.

## Attachment hydration

Local hashes load file metadata and blobs. Only metadata classified as an image with a supported raster MIME becomes an image part. Generic files with image-looking MIME remain files. Non-image hashes are excluded from image candidates; their content must be represented by file parts.

Supported raster data URLs can pass through after validation. Image-like remote URLs are fetched and checked by response MIME. Remote/blob fetch hydration has an eight-second timeout and a 5 MiB blob-size cap; failures do not produce a usable image. Local hash and binary hydration do not use that remote-fetch cap. Base64 encoding increases payload size, so upstream file/request limits still matter.

Explicit file content has its own behavior: a valid data URL or HTTP(S) URL can be used as file data; binary values and local hashes are converted; blob references need hydration. A blob URL cannot be sent directly to a remote model.

Hydrated references use shared in-memory data-URL and in-flight caches. Completed entries are bounded to 64 and disappear on page reload. Do not log attachment data, URLs, or the prepared provider payload.

## Handle failures

Attachment preparation can throw `AttachmentHydrationError` with `code: 'ATTACHMENT_HYDRATION_FAILED'`, `messageIndex`, optional filename, and a reason: `missing`, `unsupported`, `unavailable`, `invalid`, or `not-image`. It does **not** silently drop an attachment that failed hydration and proceed with a changed request.

Show the error and let the user remove or reattach the file. Do not catch it and resend text-only without the user's choice. The error text omits attachment data and URLs. See `app/core/auth/openrouter-build.ts` for the source contracts and [chat types](/documentation/types/chat-types) for internal message shapes.
