# hook-catalog

Authoritative catalog of available hooks with their argument shapes and return values. This is derived from the codebase (hook keys, payload types, and call sites) so developers don’t have to console.log.

---

## How to read this

-   Kind: action vs filter. Actions return void; filters must return the next value in the chain.
-   Args: tuple passed to your handler. Use `typedOn(hooks).on(key, fn)` for editor inference.
-   Returns: concrete return type for filters. Veto-capable filters allow `false` (or `''`) to cancel/clear.
-   Typed-only: the key exists in `hook-types.ts` but no call site emits it yet. Registering still typechecks; nothing will fire.
-   Server-side: hooks in the final section run on the admin hook engine or Nitro webhook events, not on `$hooks`.

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
| `ai.document.edit:filter:request`     | filter | `[request: DocumentAiEditRequestPayload]`        | `DocumentAiEditRequestPayload`     |
| `ai.document.edit:action:before`      | action | `[request: DocumentAiEditRequestPayload]`        | —                                  |
| `ai.document.edit:action:after`       | action | `[result: DocumentAiEditResultPayload]`          | —                                  |
| `ai.document.edit:action:error`       | action | `[result: DocumentAiEditResultPayload]`          | —                                  |

---

## Pane lifecycle

| Key                             | Kind   | Args (tuple)                                                 | Returns                 |
| ------------------------------- | ------ | ------------------------------------------------------------ | ----------------------- |
| `ui.pane.active:action`         | action | `[payload: UiPaneActivePayload]`                             | —                       |
| `ui.pane.blur:action`           | action | `[payload: UiPaneBlurPayload]`                               | —                       |
| `ui.pane.switch:action`         | action | `[payload: UiPaneSwitchPayload]`                             | —                       |
| `ui.pane.open:action:after`     | action | `[payload: UiPaneActivePayload]`                             | —                       |
| `ui.pane.close:action:before`   | action | `[payload: UiPaneActivePayload]`                             | —                       |
| `ui.pane.close:action:after`    | action | `[payload: UiPaneActivePayload]`                             | —                       |
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
| `db.messages.files.validate:filter:hashes` | filter | `[hashes: string[]]` | `string[]` |

Notes

-   Returning `false` cancels the attachment. See `components/chat/file-upload-utils.ts`.

---

## Notifications

| Key                          | Kind   | Args (tuple)                                                                                     | Returns                           |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `notify:action:push`         | action | `[payload: NotificationCreatePayload]`                                                           | —                                 |
| `notify:action:read`         | action | `[{ id: string; readAt: number }]`                                                               | —                                 |
| `notify:action:clicked`      | action | `[{ notification: NotificationEntity; action?: NotificationAction }]`                            | —                                 |
| `notify:action:cleared`      | action | `[{ count: number }]`                                                                            | —                                 |
| `notify:filter:before_store` | filter | `[payload: NotificationCreatePayload \| false, context: { source: string }]`                    | `NotificationCreatePayload \| false` |

Notes

-   `notify:filter:before_store` can veto by returning `false`.
-   Hook-based notification pushes are preferred for background completion/error events.

---

## Branching

| Key                              | Kind   | Args (tuple)                                                                                                       | Returns             |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `branch.fork:action:before`      | action | `[payload: BranchForkBeforePayload]`                                                                               | —                   |
| `branch.fork:action:after`       | action | `[payload: ThreadEntity]`                                                                                          | —                   |
| `branch.fork:filter:options`     | filter | `[options: BranchForkOptions]`                                                                                     | `BranchForkOptions` |
| `branch.retry:filter:options`    | filter | `[opts: { assistantMessageId: string; mode?: BranchMode; titleOverride?: string }]`                                | same shape as input |
| `branch.retry:action:before`     | action | `[payload: { assistantMessageId: string; precedingUserId: string; mode: BranchMode }]`                             | —                   |
| `branch.retry:action:after`      | action | `[payload: { assistantMessageId: string; precedingUserId: string; newThreadId: string; mode: BranchMode }]`        | —                   |
| `branch.context:filter:messages` | filter | `[messages: MessageEntity[], threadId: string, mode: BranchMode]`                                                  | `MessageEntity[]`   |
| `branch.context:action:after`    | action | `[payload: { threadId: string; mode: BranchMode; ancestorCount: number; localCount: number; finalCount: number }]` | —                   |

Notes

-   See `app/db/branching.ts` and `hook-types.ts` for the `Branch*` payloads.

---

## Workflow execution

| Key                                       | Kind   | Args (tuple)                                                                        | Returns |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------- | ------- |
| `workflow.execution:action:start`         | action | `[{ messageId: string; workflowId: string }]`                                      | —       |
| `workflow.execution:action:state_update`  | action | `[{ messageId: string; state: WorkflowStreamingState \| WorkflowMessageData }]`    | —       |
| `workflow.execution:action:node_complete` | action | `[{ messageId: string; nodeId: string }]`                                          | —       |
| `workflow.execution:action:complete`      | action | `[{ messageId: string; workflowId: string; finalOutput?: string }]`                | —       |

---

## Sync lifecycle

| Key                                      | Kind   | Args (tuple)                                                                                                  | Returns |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- | ------- |
| `sync.op:action:captured`                | action | `[{ op: SyncPendingOpPayload }]`                                                                              | —       |
| `sync.capture:action:nonAtomic`          | action | `[{ tableName: string; pk: string; storeNames: string[]; kind?: 'tombstone' }]`                              | —       |
| `sync.push:action:before`                | action | `[{ scope: SyncScopePayload; count: number }]`                                                                | —       |
| `sync.push:action:after`                 | action | `[{ scope: SyncScopePayload; successCount: number; failCount: number }]`                                     | —       |
| `sync.bootstrap:action:start`            | action | `[{ scope: SyncScopePayload }]`                                                                               | —       |
| `sync.bootstrap:action:progress`         | action | `[{ scope: SyncScopePayload; cursor: number; pulledCount: number; hasMore: boolean }]`                      | —       |
| `sync.bootstrap:action:complete`         | action | `[{ scope: SyncScopePayload; cursor: number; totalPulled: number; elapsedMs?: number }]`                    | —       |
| `sync.bootstrap:action:error`            | action | `[{ scope: SyncScopePayload; error: string }]`                                                                | —       |
| `sync.pull:action:received`              | action | `[{ scope: SyncScopePayload; changeCount: number }]`                                                          | —       |
| `sync.pull:action:applied`               | action | `[{ scope: SyncScopePayload; applied: number; skipped: number; conflicts: number }]`                         | —       |
| `sync.pull:action:error`                 | action | `[{ scope: SyncScopePayload; error: string }]`                                                                | —       |
| `sync.pull:action:after`                 | action | `[{ scope: SyncScopePayload; count: number; cursor: number }]` — typed only                                    | —       |
| `sync.subscription:action:statusChange`  | action | `[{ scope: SyncScopePayload; previousStatus: string; status: string }]`                                      | —       |
| `sync.subscription:action:maxRetriesExceeded` | action | `[{ scope: SyncScopePayload; attempts: number }]`                                                        | —       |
| `sync.conflict:action:detected`          | action | `[{ tableName: string; pk: string; local: unknown; remote: unknown; winner: 'local' \| 'remote' }]`        | —       |
| `sync.error:action`                      | action | `[{ op: SyncPendingOpPayload; error: unknown; permanent?: boolean }]`                                        | —       |
| `sync.retry:action`                      | action | `[{ op: SyncPendingOpPayload; attempt: number }]`                                                             | —       |
| `sync.queue:action:full`                 | action | `[{ pendingCount: number; maxSize: number }]`                                                                 | —       |
| `sync.rescan:action:starting`            | action | `[{ scope: SyncScopePayload }]`                                                                               | —       |
| `sync.rescan:action:progress`            | action | `[{ scope: SyncScopePayload; progress: number }]` — typed only                                                 | —       |
| `sync.rescan:action:completed`           | action | `[{ scope: SyncScopePayload }]`                                                                               | —       |
| `sync.stats:action`                      | action | `[{ pendingCount: number; cursor: number; lastSyncAt: number }]` — typed only                                | —       |
| `sync:action:error`                      | action | `[{ message?: string } & Record<string, unknown>]` — emitted server-side via Nitro webhook events            | —       |

---

## Workspace backup

Emitted by `app/composables/core/useWorkspaceBackup.ts`. Telemetry payloads carry progress metadata; error hooks add `error` and `durationMs`.

| Key                                        | Kind   | Args (tuple)                                                                                  | Returns |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- | ------- |
| `workspace.backup.export:action:before`    | action | `[{ format: 'stream'; filenameBase: string; suggestedName: string }]`                         | —       |
| `workspace.backup.export:action:after`     | action | `[{ format: 'stream'; filenameBase: string; suggestedName: string; durationMs: number }]`    | —       |
| `workspace.backup.export:action:error`     | action | `[{ format: 'stream'; filenameBase: string; suggestedName: string; durationMs: number; error: unknown }]` | — |
| `workspace.backup.export:action:cancelled` | action | `[{ format: 'stream'; filenameBase: string; suggestedName: string; durationMs: number }]`    | —       |
| `workspace.backup.import:action:before`    | action | `[{ fileName: string \| null; mode: 'replace' \| 'append'; overwrite: boolean; format: 'stream' \| 'dexie' \| 'unknown' }]` | — |
| `workspace.backup.import:action:after`     | action | `[same as before, with format: 'stream' \| 'dexie' + durationMs: number]`                     | —       |
| `workspace.backup.import:action:error`     | action | `[same as before, with format: 'stream' \| 'dexie' + durationMs: number + error: unknown]`    | —       |
| `workspace.backup.peek:action:before`      | action | `[{ fileName: string \| null }]`                                                              | —       |
| `workspace.backup.peek:action:after`       | action | `[{ fileName: string \| null; format: 'stream' \| 'dexie'; metadata: ImportMetadata; durationMs: number }]` | — |
| `workspace.backup.peek:action:error`       | action | `[{ fileName: string \| null; error: unknown; durationMs: number }]`                          | —       |
| `workspace:reloaded`                       | action | `[]`                                                                                          | —       |

---

## Sidebar pages

Emitted by `app/composables/sidebar/useActiveSidebarPage.ts` during page activation and guard runs.

| Key                                   | Kind   | Args (tuple)                                                                                  | Returns |
| ------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | ------- |
| `ui.sidebar.page:action:open`         | action | `[{ id: string; page: SidebarPage }]`                                                         | —       |
| `ui.sidebar.page:action:load-error`   | action | `[{ pageId: string; error: unknown; phase?: 'canActivate' \| 'onActivate' \| 'onDeactivate' }]` | —     |

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

-   `create`, `upsert`, `update`, `delete`, `get`, `byThread`/`byProject`/`children`, `search`, specialized ops like `append`, `insertAfter`, `normalize`, `fork`, `updateSystemPrompt`, plus `move`, `copy`, and `restore` on messages/files.

Special cases

-   `db.files.refchange:action:after` — `[{ before: FileEntity; after: FileEntity; delta: number }]`
-   `db.files.restore:action:before|after` — `[FileEntity]`
-   `db.kv.upsertByName:action:after` — `[KvEntry]`
-   `db.kv.deleteByName:action:hard:before|after`
-   `db.threads.updateSystemPrompt:action:before` — `[{ thread: ThreadEntity; promptId: string }]`; `:after` — `[{ thread: ThreadEntity; promptId: string }]`
-   `db.threads.getSystemPrompt:filter:output` — `[value: string | null]` → `string | null`
-   `db.documents.title:filter` — `[title: string, context: { phase: 'create' | 'update'; id: string; rawTitle?: string | null; existing?: DocumentEntity }]` → `string`
-   `db.messages.append:action:before` — `[MessageCreateEntity]`; `:after` — `[MessageEntity]`
-   `db.messages.insertAfter:action:before` — `[{ after: MessageEntity; value: MessageCreateEntity }]`; `:after` — `[MessageEntity]`
-   `db.messages.move:action:before` — `[{ message: MessageEntity; toThreadId: string }]`; `:after` — `[{ messageId: string; toThreadId: string }]`
-   `db.messages.copy:action:before` — `[{ message: MessageEntity; toThreadId: string }]`; `:after` — `[{ from: string; toThreadId: string }]`
-   `db.messages.normalize:action:before` — `[{ threadId: string; start: number; step: number }]`; `:after` — `[{ threadId: string }]`

Note: `restore`, `append`, `move`, `copy`, and `insertAfter` are emitted in code but are not yet in the `DbOperation` union in `hook-types.ts`. They typecheck through the open string fallback, not through `DbActionHookName`.

Returns quick-reference

-   Action hooks: `void \| Promise<void>`
-   Filter input hooks: return the validated/transformed input shape
-   Filter output hooks: return the transformed entity/array being output

---

## App and errors (observed in code)

| Key                                       | Kind   | Args (tuple)                                            | Returns     |
| ----------------------------------------- | ------ | ------------------------------------------------------- | ----------- |
| `app.init:action:after`                   | action | `[{ nuxtApp }]`                                        | —           |
| `error:raised`                            | action | `[error: AppError]`                                    | —           |
| `error:<domain>`                          | action | `[error: AppError]` — fired only when `tags.domain` is set | —        |
| `ai.chat.error:action`                    | action | `[{ error: AppError }]` — fired only when `tags.domain === 'chat'` | — |
| `chat.systemPrompt.select:action:after`   | action | `[payload: { id: string; content: any }]`               | —           |
| `chat.systemPrompt.default:action:update` | action | `[id: string]`                                          | —           |
| `ui.sidebar.select:action:before`         | action | `[payload: { kind: 'chat' \| 'doc'; id: string }]`      | —           |
| `ui.sidebar.select:action:after`          | action | `[payload: { kind: 'chat' \| 'doc'; id: string }]`      | —           |
| `ui.chat.new:action:after`                | action | `[payload: {}]`                                         | —           |
| `editor.created:action:after`             | action | `[payload: { editor: any }]`                            | —           |
| `editor.updated:action:after`             | action | `[payload: { editor: any }]`                            | —           |
| `editor:request-extensions`               | action | `[]`                                                    | —           |
| `ui.chat.editor:filter:extensions`        | filter | `[extensions: unknown[]]`                               | `unknown[]` |
| `ui.chat.editor:action:before_send`       | action | `[json: Record<string, unknown>]`                       | —           |

Notes

-   These are gathered from call sites across `app/**` and may evolve; prefer wildcard listeners for families like `error:*`.

---

## Authentication

| Key                              | Kind   | Args (tuple)                                                   | Returns          |
| -------------------------------- | ------ | -------------------------------------------------------------- | ---------------- |
| `auth.access:filter:decision`    | filter | `[decision: AccessDecision, context: { session: SessionContext \| null }]` | `AccessDecision` |
| `auth.user:action:created`       | action | `[{ userId: string; provider: string }]`                        | —                |
| `auth.workspace:action:created`  | action | `[{ workspaceId: string; userId: string }]` — typed only        | —                |

Notes

-   `auth.access:filter:decision` no longer runs through `hooks.applyFilters`. The server runs a deny-only constraint engine (`AuthHookEngine.applyAccessDecisionFilters` in `server/auth/hooks.ts`). Legacy filter callbacks with this signature are accepted via `addAccessDecisionFilter`, but grants are rejected and recorded in `_diagnostics.errors` under `auth.access:*` keys.
-   `auth.user:action:created` fires server-side as a Nitro webhook event from `server/auth/session.ts`.

---

## Storage

| Key                                          | Kind   | Args (tuple)                                           | Returns                                  |
| -------------------------------------------- | ------ | ------------------------------------------------------ | ---------------------------------------- |
| `storage.files.upload:action:before`         | action | `[payload: StorageFileUploadBeforePayload]`            | —                                        |
| `storage.files.upload:action:after`          | action | `[payload: StorageFileUploadAfterPayload]`             | —                                        |
| `storage.files.download:action:before`       | action | `[payload: StorageFileDownloadBeforePayload]`          | —                                        |
| `storage.files.download:action:after`        | action | `[payload: StorageFileDownloadAfterPayload]`           | —                                        |
| `storage.files.url:filter:options`           | filter | `[options: StorageFileUrlOptionsPayload]`              | `StorageFileUrlOptionsPayload`           |
| `storage.files.upload:filter:policy`         | filter | `[policy: StorageFileUploadPolicyPayload \| false]`    | `StorageFileUploadPolicyPayload \| false` |
| `storage.files.gc:action:run`                | action | `[payload: StorageFileGcPayload]` — typed only          | —                                        |
| `storage:action:error`                       | action | `[{ message?: string } & Record<string, unknown>]` — emitted server-side via Nitro webhook events | — |

---

## Server-side admin and webhook hooks

These do not run on the app `$hooks` engine.

Admin hooks run on the server admin engine (`event.context.adminHooks`, see `server/hooks/admin-hook-types.ts`):

| Key                                  | Kind   | Args (tuple)                                                                            | Returns |
| ------------------------------------ | ------ | --------------------------------------------------------------------------------------- | ------- |
| `admin.plugin:action:installed`      | action | `[{ id: string; kind: 'plugin' \| 'theme' \| 'admin_plugin'; version: string }]`        | —       |
| `admin.plugin:action:enabled`        | action | `[{ id: string; workspaceId: string }]`                                                 | —       |
| `admin.plugin:action:disabled`       | action | `[{ id: string; workspaceId: string }]`                                                 | —       |
| `admin.user:action:role_changed`     | action | `[{ workspaceId: string; userId: string; role: 'owner' \| 'editor' \| 'viewer' }]`      | —       |
| `admin.workspace:action:created`     | action | `[{ workspaceId: string; name: string; ownerUserId: string; createdBy: { kind: 'super_admin' \| 'workspace_admin'; id: string } }]` | — |
| `admin.workspace:action:deleted`     | action | `[{ workspaceId: string; deletedBy: { kind: 'super_admin' \| 'workspace_admin'; id: string } }]` | — |

Nitro webhook events fire on `nitroApp.hooks` via `emitWebhookSystemHook` and feed the webhook dispatcher (see `server/utils/webhooks/event-bridge.ts`):

-   `sync:action:error` — `[{ message?: string } & Record<string, unknown>]`
-   `storage:action:error` — `[{ message?: string } & Record<string, unknown>]`
-   `background.job:completed` / `background.job:failed` — `[{ jobId: string; status: 'completed' \| 'failed'; workspaceId: string; userId: string; threadId: string; messageId: string; error: string \| null }]`
-   `ai.chat.stream:action:complete` is also emitted server-side with the app payload plus webhook fields (`workspaceId`, `messageId`, `modelId`, `jobId`, `completedAt`).
-   Curated event bridge keys: `db.threads.create:action:after`, `db.threads.update:action:after`, `db.messages.create:action:after`, `db.messages.append:action:after`, `db.messages.update:action:after`, `ai.chat.stream:action:complete`, `db.documents.create:action:after`, `db.documents.update:action:after`, `db.documents.delete:action:soft:after`, `notify:action:push`, `auth.user:action:created`, and the admin keys above.

---

## DX tips

-   Use `typedOn(hooks)` from `hook-keys` to get argument inference for known keys.
-   Filters: always return the next value. For veto-capable filters, return `false` to cancel and `''` to clear where supported.
-   For DB hooks, check the specific module under `app/db/` to see exactly which ops emit hooks and with which shapes.
