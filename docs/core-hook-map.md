# Core Hook Map

This doc lists the core hook keys used across the app, their intent, and payload shapes. Use these as a reference when registering hooks via `$hooks` (see `app/utils/hooks.ts`) or the HMR-safe `useHookEffect`.

Notes

-   Kind: "filter" modifies or vetoes data, "action" observes side-effects or progress.
-   Priority: lower runs earlier. Defaults match the engine.
-   Avoid logging secrets or model keys.

Chat lifecycle

-   ui.chat.message:filter:outgoing (filter)
    -   In: text: string
    -   Return: string | false (return false to drop)
-   ai.chat.model:filter:select (filter)
    -   In: modelId: string
    -   Return: string (normalized/replaced model id)
-   ai.chat.messages:filter:input (filter)
    -   In: messages: any[] (AI provider input array)
    -   Return: any[] (transformed array)
-   ai.chat.send:action:before (action)
    -   In: AiSendBefore
-   ai.chat.send:action:after (action)
    -   In: AiSendAfter
-   ai.chat.stream:action:delta (action)
    -   In: chunk: string, ctx: AiStreamDeltaCtx
-   ai.chat.stream:action:reasoning (action)
    -   In: chunk: string, ctx: AiStreamReasoningCtx
-   ai.chat.stream:action:complete (action)
    -   In: AiStreamCompleteCtx
-   ai.chat.stream:action:error (action)
    -   In: AiStreamErrorCtx
-   ui.chat.message:filter:incoming (filter)
    -   In: text: string, fileHashes?: string
    -   Return: string
-   ai.chat.retry:action:before (action)
    -   In: { threadId?, originalUserId, originalAssistantId?, triggeredBy: 'user'|'assistant' }
-   ai.chat.retry:action:after (action)
    -   In: { threadId?, originalUserId, originalAssistantId?, newUserId?, newAssistantId? }

Pane and message UI

-   ui.pane.active:action (action)
    -   In: paneRef: any, index: number, prevIndex?: number
-   ui.pane.blur:action (action)
    -   In: paneRef: any, index: number
-   ui.pane.switch:action (action)
    -   In: paneRef: any, index: number
-   ui.pane.thread:filter:select (filter)
    -   In: threadId: string
    -   Return: string
-   ui.pane.thread:action:changed (action)
    -   In: paneRef: any, threadId: string|'' (prev), nextThreadId: string, index: number
-   ui.pane.doc:filter:select (filter)
    -   In: docId: string
    -   Return: string
-   ui.pane.doc:action:changed (action)
    -   In: paneRef: any, prevDocId: string|'', nextDocId: string
-   ui.pane.doc:action:saved (action)
    -   In: paneRef: any, docId: string
-   ui.pane.msg:action:sent (action)
    -   In: msg: any, payload: UiPaneMsgSentPayload
-   ui.pane.msg:action:received (action)
    -   In: msg: any, payload: UiPaneMsgReceivedPayload

Database families

DB hooks follow the pattern: `db.<family>.<event>` where family is one of:
`messages | documents | files | threads | projects | posts | prompts | attachments | kv`

-   Filters generally look like: `db.messages.filter.<op>` and return the modified input or a tuple depending on the op.
-   Actions generally look like: `db.messages.action.<op>` and receive the final entity or op context.

Refer to `app/db/*.ts` for exact shapes per operation; these are intentionally broad to allow module-local evolution without breaking global types. When adding new DB hooks, prefer reusing existing event verbs (create/update/delete/move/copy/restore/normalize) and keep payloads small and serializable.

Type helpers

-   Prefer using `typedOn($hooks).on(...)` from `app/utils/hook-keys.ts` for the keys above to get argument hints.
-   For other keys (including DB hooks), use `$hooks.on('<string>', fn, opts)` directly.
