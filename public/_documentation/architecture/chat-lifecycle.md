# Chat lifecycle and persistence

This guide explains the boundaries to preserve when changing the host chat UI. The source controller is `useChat`, exported from `app/composables/chat/useAi.ts`. Its types live in `app/utils/chat/types.ts`; use those imports rather than copying interfaces.

## Admission, durability, and completion

A send moves through admission, durable user-message persistence, response streaming, and a terminal result. Admission is single-flight for the controller; a busy request can be rejected before a message exists. An admitted request retains its originating workspace database and cancellation identity.

The native composer clears submitted text and attachments after provider acceptance, with a comparison that preserves edits made while preparation was pending. A durable user-message ID alone does not prove provider acceptance: a final legacy filter or provider can refuse context after saving that turn. Preserve the draft on `context_full` and metadata-unavailable outcomes. Accepted, completed, failed, aborted and detached remain distinct outcomes. See [send-result types](/documentation/types/chat-types#sending-and-request-state).

Create `useChat()` during component setup and dispose it on unmount. Reuse the existing `ChatContainer.vue` send and acceptance handling when extending product actions: it watches the matching request's `streaming` state with `providerAccepted`, then the terminal result, and fences draft clearing against text edits and navigation. `hasDurableSendAcceptance()` only identifies a saved user row; it is useful for durability reporting, not draft-clearing authority.

## Streaming, stopping, and teardown

The default message renderer loads through the theme registry when a message
row mounts. Empty chats keep Markdown and highlighting out of the initial
preload graph; theme-provided message components keep their existing selection.

Render the controller's UI projections rather than raw stream events. Text, reasoning, tool progress, and partial output can arrive independently. Accumulators batch UI updates; persistence and display have separate responsibilities. A transport disconnect does not necessarily mean a server background job stopped.

`createStreamAccumulator()` in `app/composables/chat/useStreamAccumulator.ts`
buffers text and reasoning separately and batches reactive flushes with animation
frames, with a microtask fallback when frames are unavailable. `finalize()`
flushes pending output and seals the accumulator idempotently. Later appends are
ignored until a reset. This display state is not a durable message receipt.

`ChatContainer.vue` uses the `or3-scroll` package for its message viewport.
Preserve keyed message anchors and the existing user's scroll intent when
updating stream projections or restoring a tab. Do not recreate the removed
`VirtualMessageList.vue` thresholds in another watcher.

`abort()` requests cancellation. `dispose()` releases view listeners/subscriptions and can leave admitted generation tracking detached. It does not delete saved messages. `clearConversation({ persistence: 'preserve' })` clears in-memory projections and preserves durable rows. Do not use teardown as a destructive conversation operation or report it as a completed cancellation.

Foreground intake checks cancellation before buffered events and after awaited
processing. Cancellation during the final incoming filter preserves accepted
partial output and produces an aborted result without success completion hooks.
The successful terminal claim is synchronous; later cancellation cannot rewrite
that claimed outcome. Tool-result insertion validates the captured thread, parent
assistant and generation under the same write transaction as its append, so a
hard deletion cannot leave a later orphan result.

Each terminal write must retain request/generation identity so late results from an older retry or workspace cannot overwrite current work. Preparation hooks run before final persistence; a callback or notification finishing is not proof that the database write succeeded. Use the existing tracker and persister recovery paths.

## Context and tools

Native message preparation snapshots content parts, selected binary attachment
bytes, canonical tool calls and media options before asynchronous context
hydration. Hydration appends to the request copy; later edits to the caller's
messages or media settings do not change that in-flight copy.

The preparation foundation exposes
`useAiSettings().captureContextPreference()`: it loads existing settings, reads
the current durable maximum through the strict KV snapshot API, and returns a
frozen scalar with its DB handle and workspace generation. A failed read or
changed workspace rejects capture; retry can recover. These origin fields are
internal and must not be serialized as provider parameters. Native initial
send, retry, continuation and foreground tool iterations consume that captured
value. Native requests send a versioned `_context` envelope containing only
the nullable user maximum and explicit reply allowance. The server resolves
capacity independently through the existing OpenRouter SDK catalog path;
client capacity claims do not authorize a larger window. Background execution
checkpoints retain the envelope across tool iterations and worker recovery.
All OR3 routing/context fields are removed from provider input and usage
fingerprints. Legacy callers without the envelope retain their prior boundary.

Native admission uses the selected model's advertised total window and the
optional user maximum. Missing capacity is refreshed through the model catalog;
unavailable capacity rejects the request with an explicit recovery reason. The
complete provider body includes selected history, system/injected content,
tool definitions and configuration. Initial native rejection precedes thread,
user and assistant writes; refused retry/continuation preserves existing rows.
There is no automatic context trimming, guessed capacity or fixed reply
reserve. An explicit reply allowance must fit the remaining window and model
output maximum. Otherwise output uses the actual remainder up to that maximum.
Counts remain estimates, particularly for images and files.

Each foreground tool request checks the complete accumulated body with the
generation's captured maximum. An oversized accepted result stays durable,
ends with `context_full`, and does not cause a tool replay or shortened retry.
Legacy side-effecting final filters still run once after real rows exist; their
mutations are checked before native inference, but that legacy contract cannot
guarantee zero turn writes. The additive pure preparation and acknowledged
commit contract is described in the [hook reference](/documentation/hooks/reference#native-chat-preparation-and-delegated-commit).

Source UI token counting uses `app/composables/core/useTokenizer.ts` and a
shared worker. When the worker is unavailable, including during SSR, it falls
back to a character heuristic rather than importing the encoder on the main
thread. A displayed count is not exact provider billing or proof of admission.

Use the admitted tool registry, schema validation, request-scoped authority, and abort signal. Server/client tool execution and background transport are coordinated by the current host implementation. A tool's name or runtime field alone does not authorize execution. [Chat tools](/documentation/utils/chat-tools) preserve frozen editor snapshots and explicit proposal review.

## Tabs and drafts

The tab session owns the open-tab manifest and active bindings. The pane adapter owns the mounted panes; chat and document controllers own content. Changing an active tab should not create a second content store.

Tab manifests persist to localStorage by workspace and profile. Composer drafts—including unsent text, editor JSON, attachment references, and settings—remain in memory and are not saved in that manifest. Reloading loses them. Draft discard revokes owned blob URLs; short deferred discard supports reopening a recently closed tab.

The pane loader reconciles separate canonical tool-result rows into their assistant calls before seeding a chat controller. Tool evidence remains visible after tab activation or reload, while plugin-owned message metadata and stored rows remain intact. Tool-call presentation metadata is retained by stable call ID; canonical status, result and error override stale embedded execution fields. Consumers should use this loader rather than treating raw assistant rows as a complete tool transcript.

A newer activation supersedes older work. Editor sessions are resolved by pane/tab identity, which matters when a document appears in more than one split. Capture outgoing edits and verify local durability before rebinding; do not assume the saved database snapshot contains everything currently visible in an editor.

See [source map](/documentation/start/source-map), [documents](/documentation/database/documents), and [workspace-safe writes](/documentation/database/safe-changes#workspace-safe-operations).
