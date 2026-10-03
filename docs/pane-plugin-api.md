# Source pane compatibility API

This is the browser-only compatibility facade installed by
[pane-plugin-api.client.ts](../app/plugins/pane-plugin-api.client.ts).
It remains useful for trusted source integrations. New installable packages
use the [SDK](../public/_documentation/plugins/plugin-sdk.md); new source pane
apps start with the
[owned workspace tutorial](../public/_documentation/start/mini-app-tutorial.md).

The facade is available as `globalThis.__or3PanePluginApi` after its client
plugin initializes. Browser globals are not permission or authorization
boundaries. Import its exported types instead of copying interfaces, and
discover pane IDs through `getPanes()` rather than hard-coding them.

## Results and ownership

Methods return `{ ok: true, ...data }` or
`{ ok: false, code, message }`. Check `ok` before using fields; the complete
error-code union lives in the defining source. Mutations require a nonempty
`source` label for diagnostics. That label does not grant workspace access.

`getPanes()` returns pane descriptors and an active index.
`getActivePaneData()` returns active pane metadata and a cloned document
snapshot when available. `recordId` aliases a backing `documentId`, including
custom pane records. A pane is a mounted viewport, not every open workspace tab.
Use the [tab commands](workspace-tabs.md) for resource opening and focus.

## Send a message

Inside a client source module:

```ts
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

export async function sendToPane(paneId: string, text: string) {
    const api = (globalThis as typeof globalThis & {
        __or3PanePluginApi?: PanePluginApi;
    }).__or3PanePluginApi;
    if (!api) throw new Error('Pane API is not ready');
    const result = await api.sendMessage({
        paneId, text, source: 'example:send', createIfMissing: true,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
}
```

The target must be a chat pane. `createIfMissing` can create and bind a thread
when it has none. For a user message with streaming enabled (the default), an
available chat-input bridge invokes the normal send controller. A durable
acceptance returns the actual user-message ID; the old placeholder
`messageId: 'bridge'` is no longer the contract. Rejection without a durable ID
returns `send_rejected`.

Successful acceptance is not proof that assistant generation completed.
If no bridge exists, streaming is disabled, or the role is assistant, the
fallback directly appends a saved message and does not start model generation.
Assistant text is stored verbatim. This facade accepts plain text, not attachment
injection. See
[chat lifecycle](../public/_documentation/architecture/chat-lifecycle.md)
for durability and cancellation semantics.

## Stage document changes

A document operation requires a doc pane with a bound document ID:

| Method | Effect |
| --- | --- |
| `updateDocumentContent({ paneId, content, source })` | Replaces staged document content |
| `patchDocumentContent({ paneId, patch, source })` | Shallow root merge; concatenates content arrays when both are arrays |
| `setDocumentTitle({ paneId, title, source })` | Stages a new title |

Provide valid TipTap JSON. A paragraph contains text nodes inside its
`content` array; a root-level `text` property on a paragraph is not equivalent.
The compatibility patcher does not provide an editor-aware operation protocol
or full schema validation.

These synchronous results confirm staging, not a completed database flush.
The document store/session owns persistence and live-editor coordination.
Check [document persistence](../public/_documentation/database/documents.md#live-editor-content-and-autosave)
before replacing visible content; use the host proposal/review flow for AI edits.

## Custom posts

The `posts` namespace wraps the active browser database:

| Method | Result data |
| --- | --- |
| `create({ postType, title, content?, meta?, source })` | Created `id` |
| `get({ id })` | `post` |
| `update({ id, patch, source })` | Success/failure |
| `delete({ id, source })` | Soft-delete success/failure |
| `listByType({ postType, limit? })` | Non-deleted `posts`, newest update first |

Create requires a nonempty title and application post type. Internal post types
are refused or hidden; they are not extension data. Update replaces provided
metadata rather than merging its fields. Reads parse JSON metadata when
possible and retain a non-JSON string as-is. A list limit truncates the sorted
results; it is not cursor pagination or a bounded database scan.

The [custom-post guide](../public/_documentation/database/posts.md) covers
the entity lifecycle. Long-lived work must retain and guard its originating
workspace; this global facade is not a captured workspace capability.

## Verify integration

Check missing panes, mismatched modes, rejected sends, actual durable message
IDs, staging followed by persistence, and workspace switches. Development
logs use `[pane-plugin-api]`. Read-only inspection results and successful
hook dispatch do not prove a write completed.
