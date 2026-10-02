# Chat lifecycle and persistence

This guide explains the boundaries to preserve when changing the host chat UI. The source controller is `useChat`, exported from `app/composables/chat/useAi.ts`. Its types live in `app/utils/chat/types.ts`; use those imports rather than copying interfaces.

## Admission, durability, and completion

A send moves through admission, durable user-message persistence, response streaming, and a terminal result. Admission is single-flight for the controller; a busy request can be rejected before a message exists. An admitted request retains its originating workspace database and cancellation identity.

Clear a draft only after the result contains a durable user-message ID. Accepted, completed, failed, aborted, and detached are different outcomes. Failure can occur after the user row is saved. See [send-result types](/documentation/types/chat-types#sending-and-request-state).

For a source component, this pattern creates the controller during setup and keeps its draft when nothing durable was saved:

```ts
import { onBeforeUnmount, ref } from 'vue';
import { useChat } from '~/composables/chat/useAi';
import { hasDurableSendAcceptance } from '~/utils/chat/types';

const chat = useChat();
const draft = ref('');

async function sendDraft(): Promise<void> {
  const submitted = draft.value;
  const result = await chat.sendMessage(submitted);
  if (hasDurableSendAcceptance(result) && draft.value === submitted) {
    draft.value = '';
  }
  // Use result.status/reason to render the outcome; a cleared draft isn't proof of completion.
}

onBeforeUnmount(() => chat.dispose());
```

The draft comparison also protects text typed while a send was pending. The existing composer has additional attachment, request-state, and durable-acceptance handling; reuse it when extending the product instead of building another send pipeline.

## Streaming, stopping, and teardown

The default message renderer loads through the theme registry when a message
row mounts. Empty chats keep Markdown and highlighting out of the initial
preload graph; theme-provided message components keep their existing selection.

Render the controller's UI projections rather than raw stream events. Text, reasoning, tool progress, and partial output can arrive independently. Accumulators batch UI updates; persistence and display have separate responsibilities. A transport disconnect does not necessarily mean a server background job stopped.

`abort()` requests cancellation. `dispose()` releases view listeners/subscriptions and can leave admitted generation tracking detached. It does not delete saved messages. `clearConversation({ persistence: 'preserve' })` clears in-memory projections and preserves durable rows. Do not use teardown as a destructive conversation operation or report it as a completed cancellation.

Each terminal write must retain request/generation identity so late results from an older retry or workspace cannot overwrite current work. Preparation hooks run before final persistence; a callback or notification finishing is not proof that the database write succeeded. Use the existing tracker and persister recovery paths.

## Context and tools

Context budgeting uses the selected model's advertised window, reserves response space, and trims history through the existing message helpers. Missing catalog metadata is refreshed; if it remains unavailable the input fallback is 8,000 tokens. Response reserve is bounded at 8,192 tokens. Counts are estimates, particularly for images and files; do not introduce a second fixed context ceiling in a caller.

Use the admitted tool registry, schema validation, request-scoped authority, and abort signal. Server/client tool execution and background transport are coordinated by the current host implementation. A tool's name or runtime field alone does not authorize execution. [Chat tools](/documentation/utils/chat-tools) preserve frozen editor snapshots and explicit proposal review.

## Tabs and drafts

The tab session owns the open-tab manifest and active bindings. The pane adapter owns the mounted panes; chat and document controllers own content. Changing an active tab should not create a second content store.

Tab manifests persist to localStorage by workspace and profile. Composer drafts—including unsent text, editor JSON, attachment references, and settings—remain in memory and are not saved in that manifest. Reloading loses them. Draft discard revokes owned blob URLs; short deferred discard supports reopening a recently closed tab.

The pane loader reconciles separate canonical tool-result rows into their assistant calls before seeding a chat controller. Tool evidence remains visible after tab activation or reload, while plugin-owned message metadata and stored rows remain intact. Tool-call presentation metadata is retained by stable call ID; canonical status, result and error override stale embedded execution fields. Consumers should use this loader rather than treating raw assistant rows as a complete tool transcript.

A newer activation supersedes older work. Editor sessions are resolved by pane/tab identity, which matters when a document appears in more than one split. Capture outgoing edits and verify local durability before rebinding; do not assume the saved database snapshot contains everything currently visible in an editor.

See [source map](/documentation/start/source-map), [documents](/documentation/database/documents), and [workspace-safe writes](/documentation/database/safe-changes#workspace-safe-operations).
