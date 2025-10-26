# hook-catalog

Authoritative catalog of available hooks with their argument shapes and return values. This is derived from the codebase (hook keys, payload types, and call sites) so developers don’t have to console.log.

---

## How to read this

-   Kind: action vs filter. Actions return void; filters must return the next value in the chain.
-   Args: tuple passed to your handler. Use `typedOn(hooks).on(key, fn)` for editor inference.
-   Returns: concrete return type for filters. Veto-capable filters allow `false` (or `''`) to cancel/clear.

See also: `hooks.md` for engine API, `hook-keys.md` and `hook-types.md` for detailed payload types.

---

## Chat and AI

| Key                                   | Kind   | Args (tuple)                                     | Returns                            |
| ------------------------------------- | ------ | ------------------------------------------------ | ---------------------------------- |
| `ui.chat.message:filter:outgoing`     | filter | `[text: string]`                                 | `string \| false` (veto to cancel) |
| `ui.chat.message:filter:incoming`     | filter | `[text: string, threadId?: string]`              | `string`                           |
| `ai.chat.model:filter:select`         | filter | `[modelId: string]`                              | `string` (new model id)            |
| `ai.chat.messages:filter:input`       | filter | `[messages: any[]]`                              | `any[]`                            |
| `ai.chat.messages:filter:before_send` | filter | `[payload: { messages: any[] }]`                 | `{ messages: any[] }`              |
| `ai.chat.send:action:before`          | action | `[payload: AiSendBeforePayload]`                 | —                                  |
| `ai.chat.send:action:after`           | action | `[payload: AiSendAfterPayload]`                  | —                                  |
| `ai.chat.stream:action:delta`         | action | `[chunk: string, ctx: AiStreamDeltaPayload]`     | —                                  |
| `ai.chat.stream:action:reasoning`     | action | `[chunk: string, ctx: AiStreamReasoningPayload]` | —                                  |
| `ai.chat.stream:action:complete`      | action | `[ctx: AiStreamCompletePayload]`                 | —                                  |
| `ai.chat.stream:action:error`         | action | `[ctx: AiStreamErrorPayload]`                    | —                                  |
| `ai.chat.retry:action:before`         | action | `[payload: AiRetryBeforePayload]`                | —                                  |
| `ai.chat.retry:action:after`          | action | `[payload: AiRetryAfterPayload]`                 | —                                  |

---

## Pane lifecycle

| Key                             | Kind   | Args (tuple)                                                 | Returns                 |
| ------------------------------- | ------ | ------------------------------------------------------------ | ----------------------- |
| `ui.pane.active:action`         | action | `[payload: UiPaneActivePayload]`                             | —                       |
| `ui.pane.blur:action`           | action | `[payload: UiPaneBlurPayload]`                               | —                       |
| `ui.pane.switch:action`         | action | `[payload: UiPaneSwitchPayload]`                             | —                       |
| `ui.pane.thread:filter:select`  | filter | `[requestedId: string, pane: PaneState, previousId: string]` | `string \| '' \| false` |
| `ui.pane.thread:action:changed` | action | `[payload: UiPaneThreadChangedPayload]`                      | —                       |
| `ui.pane.doc:filter:select`     | filter | `[requestedId: string, pane: PaneState, previousId: string]` | `string \| '' \| false` |
| `ui.pane.doc:action:changed`    | action | `[payload: UiPaneDocChangedPayload]`                         | —                       |
| `ui.pane.doc:action:saved`      | action | `[payload: UiPaneDocChangedPayload]`                         | —                       |
| `ui.pane.msg:action:sent`       | action | `[payload: UiPaneMsgSentPayload]`                            | —                       |
| `ui.pane.msg:action:received`   | action | `[payload: UiPaneMsgReceivedPayload]`                        | —                       |

Notes

-   The `select` filters support veto (`false`) and clear (`''`). See `useMultiPane.ts` and `usePaneDocuments.ts`.

---

## Files and uploads

| Key                         | Kind   | Args (tuple)                                  | Returns                            |
| --------------------------- | ------ | --------------------------------------------- | ---------------------------------- |
| `files.attach:filter:input` | filter | `[payload: FilesAttachInputPayload \| false]` | `FilesAttachInputPayload \| false` |

Notes

-   Returning `false` cancels the attachment. See `components/chat/file-upload-utils.ts`.

---

## Branching

| Key                              | Kind   | Args (tuple)                                                                                                       | Returns             |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `branch.fork:action:before`      | action | `[payload: BranchForkBeforePayload]`                                                                               | —                   |
| `branch.fork:action:after`       | action | `[payload: ThreadEntity]`                                                                                          | —                   |
| `branch.retry:filter:options`    | filter | `[opts: { assistantMessageId: string; mode?: BranchMode; titleOverride?: string }]`                                | same shape as input |
| `branch.retry:action:before`     | action | `[payload: { assistantMessageId: string; precedingUserId: string; mode: BranchMode }]`                             | —                   |
| `branch.retry:action:after`      | action | `[payload: { assistantMessageId: string; precedingUserId: string; newThreadId: string; mode: BranchMode }]`        | —                   |
| `branch.context:filter:messages` | filter | `[messages: MessageEntity[], threadId: string, mode: BranchMode]`                                                  | `MessageEntity[]`   |
| `branch.context:action:after`    | action | `[payload: { threadId: string; mode: BranchMode; ancestorCount: number; localCount: number; finalCount: number }]` | —                   |

Notes

-   See `app/db/branching.ts` and `hook-types.ts` for the `Branch*` payloads.

---

## Database families (patterns)

Families: `messages | documents | files | threads | projects | posts | prompts | attachments | kv`

Actions

-   Before/after hooks per operation: `db.<family>.<op>:action:before|after`
-   Delete also emits `soft|hard` phases: `db.<family>.delete:action:soft|hard:before|after`

Filters

-   Input validators/transformers: `db.<family>.<op>:filter:input` — returns the (possibly transformed) input payload
-   Output mappers: `db.<family>.<op>:filter:output` — returns the (possibly transformed) result value

Common ops per family (varies by module; see each `app/db/*.ts`):

-   `create`, `upsert`, `update`, `delete`, `get`, `byThread`/`byProject`/`children`, `search`, specialized ops like `append`, `insertAfter`, `normalize`, `fork`, `updateSystemPrompt`.

Special cases

-   `db.files.refchange:action:after`
-   `db.kv.upsertByName:action:after`
-   `db.kv.deleteByName:action:hard:before|after`

Returns quick-reference

-   Action hooks: `void \| Promise<void>`
-   Filter input hooks: return the validated/transformed input shape
-   Filter output hooks: return the transformed entity/array being output

---

## App and errors (observed in code)

| Key                                       | Kind   | Args (tuple)                              | Returns               |
| ----------------------------------------- | ------ | ----------------------------------------- | --------------------- | --- |
| `app.init:action:after`                   | action | `[nuxtApp: any]`                          | —                     |
| `error:raised`                            | action | `[error: unknown]`                        | —                     |
| `error:<domain>`                          | action | `[error: unknown]`                        | —                     |
| `ai.chat.error:action`                    | action | `[payload: { error: unknown }]`           | —                     |
| `chat.systemPrompt.select:action:after`   | action | `[payload: { id: string; content: any }]` | —                     |
| `chat.systemPrompt.default:action:update` | action | `[id: string]`                            | —                     |
| `ui.sidebar.select:action:before`         | action | `[payload: { kind: 'chat'                 | 'doc'; id: string }]` | —   |
| `ui.sidebar.select:action:after`          | action | `[payload: { kind: 'chat'                 | 'doc'; id: string }]` | —   |
| `ui.chat.new:action:after`                | action | `[payload: {}]`                           | —                     |
| `editor.created:action:after`             | action | `[payload: { editor: any }]`              | —                     |
| `editor.updated:action:after`             | action | `[payload: { editor: any }]`              | —                     |

Notes

-   These are gathered from call sites across `app/**` and may evolve; prefer wildcard listeners for families like `error:*`.

---

## DX tips

-   Use `typedOn(hooks)` from `hook-keys` to get argument inference for known keys.
-   Filters: always return the next value. For veto-capable filters, return `false` to cancel and `''` to clear where supported.
-   For DB hooks, check the specific module under `app/db/` to see exactly which ops emit hooks and with which shapes.
