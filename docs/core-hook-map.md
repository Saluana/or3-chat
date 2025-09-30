# Core Hook Map

This document provides a comprehensive reference of all core hooks available in the application. Hooks are the primary extension mechanism, allowing plugins to observe events (actions) or transform data (filters) without modifying core code.

## Hook Types

-   **Actions**: Fire-and-forget side effects (logging, analytics, UI updates)
-   **Filters**: Transform values in a pipeline (value-in → value-out)

## Veto Semantics

Some filters support veto behavior:

-   Returning `false` cancels the operation
-   Returning an empty string `''` may clear or skip the operation (context-dependent)
-   Filters are always chainable — each receives the output of the previous

## Priority

-   Lower priority runs earlier (default 10)
-   Use priority to control hook execution order
-   Equal priorities preserve insertion order

## Chat & Message Lifecycle

### Outgoing Message

**`ui.chat.message:filter:outgoing`** (filter)

-   **Phase**: Before user message is appended to thread
-   **Input**: `text: string`
-   **Return**: `string | false`
-   **Veto**: `false` or empty string skips append and network call
-   **Use cases**: Input sanitization, content moderation, text preprocessing

### Model Selection

**`ai.chat.model:filter:select`** (filter)

-   **Phase**: Before sending request to AI
-   **Input**: `modelId: string`
-   **Return**: `string` (model ID to use)
-   **Use cases**: Override model selection, A/B testing

### Message Transform

**`ai.chat.messages:filter:input`** (filter)

-   **Phase**: Before messages sent to AI
-   **Input**: `messages: any[]`
-   **Return**: `any[]`
-   **Use cases**: Context injection, prompt engineering

### Send Lifecycle

**`ai.chat.send:action:before`** (action)

-   **Phase**: Before streaming starts
-   **Payload**: `AiSendBefore { threadId?, modelId, user: { id, length }, assistant: { id, streamId }, messagesCount? }`
-   **Use cases**: Track send events, analytics

**`ai.chat.send:action:after`** (action)

-   **Phase**: After response complete or aborted
-   **Payload**: `AiSendAfter { threadId?, request?, response?, timings?, aborted? }`
-   **Use cases**: Completion tracking, metrics

### Streaming

**`ai.chat.stream:action:delta`** (action)

-   **Phase**: Each text delta
-   **Payload**: `chunk: string, ctx: AiStreamDeltaCtx { threadId?, assistantId, streamId, deltaLength, totalLength, chunkIndex }`
-   **Use cases**: Live UI updates, progress

**`ai.chat.stream:action:reasoning`** (action)

-   **Phase**: Reasoning content streamed
-   **Payload**: `chunk: string, ctx: AiStreamReasoningCtx { threadId?, assistantId, streamId, reasoningLength }`
-   **Use cases**: Display reasoning UI

**`ai.chat.stream:action:complete`** (action)

-   **Phase**: Streaming ends successfully
-   **Payload**: `AiStreamCompleteCtx { threadId?, assistantId, streamId, totalLength, reasoningLength?, fileHashes? }`
-   **Use cases**: Final processing, metrics

**`ai.chat.stream:action:error`** (action)

-   **Phase**: Stream errors or aborts
-   **Payload**: `AiStreamErrorCtx { threadId?, streamId?, error?, aborted? }`
-   **Use cases**: Error tracking, retry logic

### Incoming Message

**`ui.chat.message:filter:incoming`** (filter)

-   **Phase**: After assistant response, before persist
-   **Input**: `text: string, threadId?: string`
-   **Return**: `string`
-   **Use cases**: Response formatting, filtering

### Retry

**`ai.chat.retry:action:before`** (action)

-   **Payload**: `{ threadId?, originalUserId, originalAssistantId?, triggeredBy: 'user'|'assistant' }`

**`ai.chat.retry:action:after`** (action)

-   **Payload**: `{ threadId?, originalUserId, originalAssistantId?, newUserId?, newAssistantId? }`

## Pane Lifecycle

**`ui.pane.open:action:after`** (action)

-   **Payload**: `{ pane: PaneState, index: number, previousIndex?: number }`
-   **Use cases**: Track pane creation, initialize state

**`ui.pane.close:action:before`** (action)

-   **Payload**: `{ pane: PaneState, index: number, previousIndex?: number }`
-   **Use cases**: Cleanup, state preservation

**`ui.pane.switch:action`** (action)

-   **Payload**: `{ pane: PaneState, index: number, previousIndex?: number }`
-   **Use cases**: Track navigation

**`ui.pane.active:action`** (action)

-   **Payload**: `{ pane: PaneState, index: number, previousIndex?: number }`
-   **Use cases**: Focus management, lazy loading

**`ui.pane.blur:action`** (action)

-   **Payload**: `{ pane: PaneState, previousIndex: number }`
-   **Use cases**: State saving, cleanup

**`ui.pane.thread:filter:select`** (filter)

-   **Input**: `threadId: string`
-   **Return**: `string | '' | false` (false cancels, '' clears)
-   **Use cases**: Validate selection, access control

**`ui.pane.thread:action:changed`** (action)

-   **Payload**: `{ pane: PaneState, oldThreadId: string | '', newThreadId: string, paneIndex: number, messageCount?: number }`
-   **Use cases**: Update UI, load related data

**`ui.pane.doc:filter:select`** (filter)

-   **Input**: `docId: string`
-   **Return**: `string | '' | false`
-   **Use cases**: Validate selection, access control

**`ui.pane.doc:action:changed`** (action)

-   **Payload**: `{ pane: PaneState, oldDocumentId: string | '', newDocumentId: string, paneIndex: number, meta?: Record<string, any> }`
-   **Use cases**: Load document, update state

**`ui.pane.doc:action:saved`** (action)

-   **Payload**: `{ pane: PaneState, oldDocumentId: string | '', newDocumentId: string, paneIndex: number, meta?: Record<string, any> }`
-   **Use cases**: Sync to server, notifications

**`ui.pane.msg:action:sent`** (action)

-   **Payload**: `{ pane: PaneState, paneIndex: number, message: { id: string; threadId?: string; length?: number; fileHashes?: string[] }, meta?: Record<string, any> }`
-   **Use cases**: Track messages per pane

**`ui.pane.msg:action:received`** (action)

-   **Payload**: `{ pane: PaneState, paneIndex: number, message: { id: string; threadId?: string; length?: number; fileHashes?: string[]; reasoningLength?: number }, meta?: Record<string, any> }`
-   **Use cases**: Update pane state, notifications

Database families

DB hooks follow the pattern: `db.<family>.<event>` where family is one of:
`messages | documents | files | threads | projects | posts | prompts | attachments | kv`

-   Filters generally look like: `db.messages.filter.<op>` and return the modified input or a tuple depending on the op.
-   Actions generally look like: `db.messages.action.<op>` and receive the final entity or op context.

Refer to `app/db/*.ts` for exact shapes per operation; these are intentionally broad to allow module-local evolution without breaking global types. When adding new DB hooks, prefer reusing existing event verbs (create/update/delete/move/copy/restore/normalize) and keep payloads small and serializable.

Type helpers

-   Prefer using `typedOn($hooks).on(...)` from `app/utils/hook-keys.ts` for the keys above to get argument hints.
-   For other keys (including DB hooks), use `$hooks.on('<string>', fn, opts)` directly.
