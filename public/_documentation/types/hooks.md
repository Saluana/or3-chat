# Hooks types

Canonical reference for every exported TypeScript type and interface that powers the hook engine. All definitions come from `app/core/hooks/**/*.ts` (with the engine primitives defined in `shared/hooks/hook-engine-core.ts` and re-exported) and are grouped by concern so you can locate payload shapes, key unions, and helper generics quickly.

---

## Engine primitives

| Name              | Kind       | Description                                                                                                                             |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `HookKind`        | union      | `'action'` or `'filter'`; used to declare hook registration intent.                                                                     |
| `RegisterOptions` | interface  | Common options (`priority`, `acceptedArgs`) shared by action/filter registration helpers.                                               |
| `OnOptions`       | interface  | Extends `RegisterOptions` with optional `kind` to drive the ergonomic `on()` helper.                                                    |
| `HookEngine`      | interface  | Runtime contract implemented by `createHookEngine()`; exposes registration, execution, diagnostics, and lifecycle helpers.              |
| `HookFn`          | type alias | Re-exports the internal `AnyFn` as a convenience import for external `.d.ts` usage.                                                     |
| `TypedHookEngine` | interface  | Purely type-level wrapper returned by `createTypedHookEngine()` exposing fully typed action/filter helpers while delegating at runtime. |

---

### TypeScript reference

```ts
// Source: shared/hooks/hook-engine-core.ts (re-exported by app/core/hooks/hooks.ts)
export type HookKind = 'action' | 'filter';

export interface RegisterOptions {
    priority?: number;
    acceptedArgs?: number;
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

export type HookFn = (...args: unknown[]) => unknown;

export interface HookEngine {
    addFilter<F extends (...args: any[]) => any>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ): void;
    removeFilter<F extends (...args: any[]) => any>(
        name: string,
        fn: F,
        priority?: number
    ): void;
    applyFilters<T>(name: string, value: T, ...args: unknown[]): Promise<T>;
    applyFiltersSync<T>(name: string, value: T, ...args: unknown[]): T;

    addAction<F extends (...args: any[]) => any>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ): void;
    removeAction<F extends (...args: any[]) => any>(
        name: string,
        fn: F,
        priority?: number
    ): void;
    doAction(name: string, ...args: unknown[]): Promise<void>;
    doActionSync(name: string, ...args: unknown[]): void;

    hasFilter(name?: string, fn?: HookFn): boolean | number;
    hasAction(name?: string, fn?: HookFn): boolean | number;
    removeAllCallbacks(priority?: number): void;
    currentPriority(): number | false;

    onceAction(name: string, fn: HookFn, priority?: number): () => void;
    on(name: string, fn: HookFn, opts?: OnOptions): () => void;
    off(disposer: () => void): void;

    _diagnostics: {
        // Rolling windows: 128 samples per hook, 2,048 distinct hook names.
        timings: Record<string, number[]>;
        errors: Record<string, number>;
        callbacks(actionOrFilter?: HookKind): number;
    };
}

// Source: app/core/hooks/typed-hooks.ts
type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];

export interface TypedHookEngine {
    addAction<K extends ActionHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;
    removeAction<K extends ActionHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;
    doAction<K extends ActionHookName>(
        name: K,
        ...args: InferHookParams<K>
    ): Promise<void>;
    doActionSync<K extends ActionHookName>(
        name: K,
        ...args: InferHookParams<K>
    ): void;
    addFilter<K extends FilterHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;
    removeFilter<K extends FilterHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;
    applyFilters<K extends FilterHookName>(
        name: K,
        value: InferHookParams<K>[0],
        ...args: Tail<InferHookParams<K>>
    ): Promise<InferHookReturn<K>>;
    applyFiltersSync<K extends FilterHookName>(
        name: K,
        value: InferHookParams<K>[0],
        ...args: Tail<InferHookParams<K>>
    ): InferHookReturn<K>;
    on<K extends HookName>(
        name: K,
        callback: InferHookCallback<K>,
        opts?: OnOptions & {
            kind?: K extends ActionHookName
                ? 'action'
                : K extends FilterHookName
                ? 'filter'
                : 'action' | 'filter';
        }
    ): () => void;
    off(disposer: () => void): void;
    onceAction<K extends ActionHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): () => void;
    hasAction<K extends ActionHookName>(
        name?: K,
        fn?: InferHookCallback<K>
    ): boolean | number;
    hasFilter<K extends FilterHookName>(
        name?: K,
        fn?: InferHookCallback<K>
    ): boolean | number;
    removeAllCallbacks(priority?: number): void;
    currentPriority(): number | false;
    readonly _engine: HookEngine;
    readonly _diagnostics: HookEngine['_diagnostics'];
}
```

---

## Key unions and handlers

| Name                       | Kind             | Description                                                                                                                                   |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `KnownHookKey`             | union            | Enumerates high-signal hook names (chat, document AI, pane, sync, and notification hooks) for first-class editor autocomplete.                |
| `DbFamily`                 | union            | Database table families (`'messages'`, `'documents'`, `'files'`, `'threads'`, `'projects'`, `'posts'`, `'prompts'`, `'attachments'`, `'kv'`). |
| `DbHookKey`                | template literal | Forms `db.${DbFamily}.${string}` for flexible DB hook addressing.                                                                             |
| `HookKey`                  | union            | Final public key type combining `KnownHookKey`, `DbHookKey`, and an open string fallback for plugins.                                         |
| `HookPayloadMap`           | type alias     | Maps every hook name (core and DB-derived) to its listener argument tuple; foundation for all inference helpers.                              |
| `ChatOutgoingFilterReturn` | alias            | `string \| false`; standardized return contract for outgoing chat filters.                                                                    |
| `ChatIncomingFilterReturn` | alias            | Always `string`; incoming assistant transforms must emit text.                                                                                |
| `FilesAttachFilterReturn`  | alias            | `FilesAttachInputPayload \| false`; allows file-attach veto from filters.                                                                     |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-keys.ts
export type KnownHookKey =
    | 'ui.chat.message:filter:outgoing'
    | 'ui.chat.message:filter:incoming'
    | 'ai.chat.model:filter:select'
    | 'ai.chat.messages:filter:input'
    | 'ai.chat.send:action:before'
    | 'ai.chat.send:action:after'
    | 'ai.chat.stream:action:delta'
    | 'ai.chat.stream:action:reasoning'
    | 'ai.chat.stream:action:complete'
    | 'ai.chat.stream:action:error'
    | 'ai.chat.retry:action:before'
    | 'ai.chat.retry:action:after'
    | 'ai.document.edit:filter:request'
    | 'ai.document.edit:action:before'
    | 'ai.document.edit:action:after'
    | 'ai.document.edit:action:error'
    | 'ui.pane.active:action'
    | 'ui.pane.blur:action'
    | 'ui.pane.switch:action'
    | 'ui.pane.thread:filter:select'
    | 'ui.pane.thread:action:changed'
    | 'ui.pane.doc:filter:select'
    | 'ui.pane.doc:action:changed'
    | 'ui.pane.doc:action:saved'
    | 'ui.pane.msg:action:sent'
    | 'ui.pane.msg:action:received'
    | 'files.attach:filter:input'
    | 'sync.bootstrap:action:start'
    | 'sync.bootstrap:action:progress'
    | 'sync.bootstrap:action:complete'
    | 'sync.pull:action:received'
    | 'sync.pull:action:applied'
    | 'sync.pull:action:error'
    | 'sync.pull:action:after'
    | 'sync.subscription:action:statusChange'
    | 'sync.conflict:action:detected'
    | 'sync.op:action:captured'
    | 'sync.push:action:before'
    | 'sync.push:action:after'
    | 'sync.error:action'
    | 'sync.retry:action'
    | 'sync.queue:action:full'
    | 'sync.rescan:action:starting'
    | 'sync.rescan:action:progress'
    | 'sync.rescan:action:completed'
    | 'sync.stats:action'
    | 'notify:action:push'
    | 'notify:action:read'
    | 'notify:action:clicked'
    | 'notify:action:cleared'
    | 'notify:filter:before_store';

export type DbFamily =
    | 'messages'
    | 'documents'
    | 'files'
    | 'threads'
    | 'projects'
    | 'posts'
    | 'prompts'
    | 'attachments'
    | 'kv';

export type DbHookKey = `db.${DbFamily}.${string}`;

export type HookKey = KnownHookKey | DbHookKey | (string & {});

// Source: app/core/hooks/hook-types.ts
// HookPayloadMap maps every core, DB-derived, and plugin-augmented hook name
// to its argument tuple. CoreHookPayloadMap holds the explicit built-ins;
// DbActionMap / DbFilterMap derive tuples for db.* template keys.
export type CoreHookPayloadMap = {
    'ai.chat.send:action:before': [AiSendBeforePayload];
    'ai.chat.send:action:after': [AiSendAfterPayload];
    // ...full list in app/core/hooks/hook-types.ts
};
export type HookPayloadMap = CoreHookPayloadMap & DbActionMap & DbFilterMap & Or3ActionHooks & Or3FilterHooks;

export type ChatOutgoingFilterReturn = string | false;
export type ChatIncomingFilterReturn = string;
export type FilesAttachFilterReturn = FilesAttachInputPayload | false;
```

---

## AI and chat payloads

| Name                        | Kind      | Description                                                                           |
| --------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `AiSendBeforePayload`       | interface | Context before streaming begins (thread, model, user/assistant metadata).             |
| `AiSendAfterPayloadTimings` | interface | Timing breakdown (`startedAt`, `endedAt`, `durationMs`) attached to send completions. |
| `AiSendAfterPayload`        | interface | Post-send context including request/response summaries, timings, and abort flag.      |
| `AiStreamDeltaContext`      | interface | Token delta context (`threadId`, `assistantId`, lengths, `chunkIndex`).               |
| `AiStreamReasoningContext`  | interface | Reasoning stream metadata (reasoning span length).                                    |
| `AiStreamCompleteContext`   | interface | Final stream state (total length, reasoning length, file hashes).                     |
| `AiStreamErrorContext`      | interface | Error detail for streaming failures or aborts.                                        |
| `AiStreamDeltaPayload`      | alias     | Equal to `AiStreamDeltaContext` for ergonomics.                                       |
| `AiStreamReasoningPayload`  | alias     | Equal to `AiStreamReasoningContext`.                                                  |
| `AiStreamCompletePayload`   | alias     | Equal to `AiStreamCompleteContext`.                                                   |
| `AiStreamErrorPayload`      | alias     | Equal to `AiStreamErrorContext`.                                                      |
| `AiRetryBeforePayload`      | interface | Retry initiation context (original user/assistant IDs, trigger source).               |
| `AiRetryAfterPayload`       | interface | Retry completion context (replacement message IDs, thread).                           |
| `DocumentAiEditRequestPayload` | interface | Document AI edit request (document, model, prompt, scope, references, token estimate). |
| `DocumentAiEditResultPayload` | interface | Result of a document AI edit (request echo, operation count, acceptance, error).    |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-types.ts
export interface AiSendBeforePayload {
    threadId?: string;
    modelId: string;
    user: { id: string; length: number };
    assistant: { id: string; streamId: string };
    messagesCount?: number;
}

export interface AiSendAfterPayloadTimings {
    startedAt: number;
    endedAt: number;
    durationMs: number;
}

export interface AiSendAfterPayload {
    threadId?: string;
    request?: { modelId?: string; userId?: string };
    response?: { assistantId?: string; length?: number };
    timings?: AiSendAfterPayloadTimings;
    aborted?: boolean;
}

export interface AiStreamDeltaContext {
    threadId?: string;
    assistantId: string;
    streamId: string;
    deltaLength: number;
    totalLength: number;
    chunkIndex: number;
}

export interface AiStreamReasoningContext {
    threadId?: string;
    assistantId: string;
    streamId: string;
    reasoningLength: number;
}

export interface AiStreamCompleteContext {
    threadId?: string;
    assistantId: string;
    streamId: string;
    totalLength: number;
    reasoningLength?: number;
    fileHashes?: string | null;
}

export interface AiStreamErrorContext {
    threadId?: string;
    streamId?: string;
    error?: unknown;
    aborted?: boolean;
}

export type AiStreamDeltaPayload = AiStreamDeltaContext;
export type AiStreamReasoningPayload = AiStreamReasoningContext;
export type AiStreamCompletePayload = AiStreamCompleteContext;
export type AiStreamErrorPayload = AiStreamErrorContext;

export interface AiRetryBeforePayload {
    threadId?: string;
    originalUserId: string;
    originalAssistantId?: string;
    triggeredBy: 'user' | 'assistant';
}

export interface AiRetryAfterPayload {
    threadId?: string;
    originalUserId: string;
    originalAssistantId?: string;
    newUserId?: string;
    newAssistantId?: string;
}

export interface DocumentAiEditRequestPayload {
    documentId: string;
    modelId: string;
    prompt: string;
    scope: 'selection' | 'section' | 'document';
    context: string;
    references: Array<{
        id: string;
        source: 'document' | 'chat';
        label: string;
    }>;
    referenceContext: string;
    tokenEstimate: number;
    maxIterations?: number;
    chunkWordLimit?: number;
}

export interface DocumentAiEditResultPayload {
    request: DocumentAiEditRequestPayload;
    operationCount?: number;
    accepted?: boolean;
    error?: unknown;
}
```

---

## Pane and UI payloads

| Name                         | Kind      | Description                                                            |
| ---------------------------- | --------- | ---------------------------------------------------------------------- | -------------- |
| `UiPaneMsgBase`              | interface | Core shape for pane messages (`id`, `threadId`, lengths, file hashes). |
| `UiPaneMsgReceived`          | interface | Extends `UiPaneMsgBase` with optional `reasoningLength`.               |
| `UiPaneActivePayload`        | interface | Fired when a pane becomes active (`pane`, `index`, `previousIndex`).   |
| `UiPaneBlurPayload`          | interface | Blur event payload capturing previous focus index.                     |
| `UiPaneSwitchPayload`        | interface | Pane switch payload with current and previous indices.                 |
| `UiPaneThreadChangedPayload` | interface | Thread change detail (old/new IDs, pane index, message count).         |
| `UiPaneDocChangedPayload`    | interface | Document change detail (old/new doc IDs, pane index, metadata).        |
| `UiPaneMsgSentPayload`       | interface | Outgoing pane message context including optional `meta`.               |
| `UiPaneMsgReceivedPayload`   | interface | Incoming pane message context including reasoning metadata.            |
| `UiSidebarSelectPayload`     | interface | Sidebar selection event (`kind: 'chat'                                 | 'doc'`, `id`). |
| `UiChatNewPayload`           | interface | Chat creation context (thread ID, creation timestamp).                 |
| `AppInitPayload`             | interface | Nuxt application bootstrap payload (`nuxtApp`).                        |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-types.ts
type PaneState = MultiPaneState;

export interface UiPaneMsgBase {
    id: string;
    threadId?: string;
    length?: number;
    fileHashes?: string | null;
}

export interface UiPaneMsgReceived extends UiPaneMsgBase {
    reasoningLength?: number;
}

export interface UiPaneActivePayload {
    pane: PaneState;
    index: number;
    previousIndex?: number;
}

export interface UiPaneBlurPayload {
    pane: PaneState;
    previousIndex: number;
}

export interface UiPaneSwitchPayload {
    pane: PaneState;
    index: number;
    previousIndex?: number;
}

export interface UiPaneThreadChangedPayload {
    pane: PaneState;
    oldThreadId: string | '';
    newThreadId: string;
    paneIndex: number;
    messageCount?: number;
}

export interface UiPaneDocChangedPayload {
    pane: PaneState;
    oldDocumentId: string | '';
    newDocumentId: string;
    paneIndex: number;
    meta?: Record<string, unknown>;
}

export interface UiPaneMsgSentPayload {
    pane: PaneState;
    paneIndex: number;
    message: UiPaneMsgBase;
    meta?: Record<string, unknown>;
}

export interface UiPaneMsgReceivedPayload {
    pane: PaneState;
    paneIndex: number;
    message: UiPaneMsgReceived;
    meta?: Record<string, unknown>;
}

export interface UiSidebarSelectPayload {
    kind: 'chat' | 'doc';
    id: string;
}

export interface UiChatNewPayload {
    threadId?: string;
    createdAt?: number;
}

export interface AppInitPayload {
    nuxtApp: unknown;
}
```

---

## Files, uploads, and attachments

| Name                      | Kind      | Description                                                                                       |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `FilesAttachInputPayload` | interface | Filter payload describing a candidate file (`file`, `name`, `mime`, `size`, `kind`).              |
| `FilesAttachPayload`      | interface | Extends `FilesAttachInputPayload` with persistence metadata (`accepted`, optional `url`, `hash`). |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-types.ts
export interface FilesAttachInputPayload {
    file: File;
    name: string;
    mime: string;
    size: number;
    kind: 'image' | 'pdf';
}

export interface FilesAttachPayload extends FilesAttachInputPayload {
    accepted: boolean;
    url?: string;
    hash?: string;
}
```

---

## Branching and context utilities

| Name                        | Kind      | Description                                                                        |
| --------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `BranchMode`                | alias     | `'reference'` or `'copy'` branch semantics.                                        |
| `BranchForkOptions`         | interface | Input parameters when forking threads (source IDs, mode, optional title override). |
| `RetryBranchParams`         | interface | Input parameters for retry-branching an assistant reply (message ID, mode, title). |
| `BranchForkBeforePayload`   | interface | Pre-fork payload used by hooks (`source`, `anchor`, `mode`, optional `options`).   |
| `BranchContextAfterPayload` | interface | Post-branch context summary (thread counts, mode).                                 |
| `KvUpsertByNameInput`       | interface | Convenience payload for KV upserts by `name`.                                      |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-types.ts
export type BranchMode = 'reference' | 'copy';

export interface BranchForkOptions {
    sourceThreadId: string;
    anchorMessageId: string;
    mode?: BranchMode;
    titleOverride?: string;
}

export interface RetryBranchParams {
    assistantMessageId: string;
    mode?: BranchMode;
    titleOverride?: string;
}

export interface BranchForkBeforePayload {
    source: ThreadEntity;
    anchor: MessageEntity;
    mode: BranchMode;
    options?: { titleOverride?: string };
}

export interface BranchContextAfterPayload {
    threadId: string;
    mode: BranchMode;
    ancestorCount: number;
    localCount: number;
    finalCount: number;
}

export interface KvUpsertByNameInput {
    name: string;
    value: unknown;
}
```

---

## Entity mirrors and DB payload wrappers

| Name                 | Kind      | Description                                                                                |
| -------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `MessageEntity`      | interface | Hook-friendly projection of a message row (`id`, `thread_id`, `role`, `data`, timestamps). |
| `MessageCreateEntity`| interface | Input projection for message create hooks (`file_hashes` may be an array).                 |
| `ThreadEntity`       | interface | Thread metadata consumed by hooks (status, branching info, clock).                         |
| `ThreadCreateEntity` | interface | Input projection for thread create hooks.                                                  |
| `DocumentEntity`     | interface | Document metadata for hooks (title, content, file hashes, timestamps).                     |
| `FileEntity`         | interface | File metadata (`hash`, `name`, `mime`, `size`, reference count).                           |
| `ProjectEntity`      | interface | Project record summary (name, description, clock flags).                                   |
| `PostEntity`         | interface | Lightweight post/blog record.                                                              |
| `PostCreateEntity`   | interface | Input projection for post create hooks.                                                    |
| `PromptEntity`       | interface | Prompt data (`id`, `name`, `text`, tags, favorite).                                        |
| `AttachmentEntity`   | interface | Attachment record linking messages to files.                                               |
| `KvEntry`            | interface | Key-value store record (name/value, clocks, timestamps).                                   |
| `DbCreatePayload<T>` | interface | Generic wrapper emitted before/after `create` operations (`entity`, `tableName`).          |
| `DbUpdatePayload<T>` | interface | Wrapper for update lifecycle (existing, updated, patch, table).                            |
| `DbDeletePayload<T>` | interface | Wrapper for delete lifecycle (entity, id, table).                                          |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-domain-types.ts (re-exported by hook-types.ts)
export interface MessageEntity {
    id: string;
    thread_id: string;
    role: string;
    pending?: boolean;
    data?: unknown;
    index: number;
    created_at: number;
    updated_at?: number;
}

export interface MessageCreateEntity {
    id?: string;
    thread_id: string;
    role: string;
    pending?: boolean;
    data?: unknown;
    index?: number;
    created_at?: number;
    updated_at?: number;
    file_hashes?: string | string[] | null;
    error?: string | null;
    deleted?: boolean;
    stream_id?: string | null;
    clock?: number;
}

export interface ThreadEntity {
    id: string;
    title?: string | null;
    created_at: number;
    updated_at: number;
    last_message_at?: number | null;
    parent_thread_id?: string | null;
    anchor_message_id?: string | null;
    anchor_index?: number | null;
    branch_mode?: 'reference' | 'copy' | null;
    status: string;
    deleted: boolean;
    pinned: boolean;
    clock: number;
    forked: boolean;
    project_id?: string | null;
    system_prompt_id?: string | null;
}

export interface ThreadCreateEntity {
    id?: string;
    title?: string | null;
    created_at?: number;
    updated_at?: number;
    last_message_at?: number | null;
    parent_thread_id?: string | null;
    anchor_message_id?: string | null;
    anchor_index?: number | null;
    branch_mode?: 'reference' | 'copy' | null;
    status?: string;
    deleted?: boolean;
    pinned?: boolean;
    clock?: number;
    forked?: boolean;
    project_id?: string | null;
    system_prompt_id?: string | null;
}

export interface DocumentEntity {
    id: string;
    title?: string;
    content?: string;
    file_hashes?: string | null;
    created_at?: number;
    updated_at?: number;
}

export interface FileEntity {
    hash: string;
    name: string;
    mime: string;
    size: number;
    ref_count?: number;
}

export interface ProjectEntity {
    id: string;
    name: string;
    description?: string | null;
    data: unknown;
    created_at: number;
    updated_at: number;
    deleted: boolean;
    clock: number;
}

export interface PostEntity {
    id: string;
    title?: string;
    body?: string;
    created_at?: number;
    updated_at?: number;
}

export interface PostCreateEntity {
    id?: string;
    title: string;
    content?: string;
    postType?: string;
    created_at?: number;
    updated_at?: number;
    deleted?: boolean;
    meta?: unknown;
    file_hashes?: string | null;
}

export interface PromptEntity {
    id: string;
    name: string;
    text: string;
    tags?: string[];
    favorite?: boolean;
}

export interface AttachmentEntity {
    id: string;
    message_id?: string;
    file_hash?: string;
}

export interface KvEntry {
    id: string;
    name: string;
    value?: string | null;
    created_at: number;
    updated_at: number;
    clock: number;
}

export interface DbCreatePayload<T = unknown> {
    entity: T;
    tableName: string;
}

export interface DbUpdatePayload<T = unknown> {
    existing: T;
    updated: T;
    patch: Partial<T>;
    tableName: string;
}

export interface DbDeletePayload<T = unknown> {
    entity: T;
    id: string;
    tableName: string;
}
```

---

## Auth, sync, storage, and notification payloads

These payloads power the cloud-facing hook families. They all live in `app/core/hooks/hook-domain-types.ts` and are re-exported through `hook-types.ts`.

| Name                              | Kind      | Description                                                                        |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `Permission`                      | union     | Authorization permissions (`'workspace.read'`, `'workspace.write'`, `'admin.access'`, …). |
| `WorkspaceRole`                   | union     | `'owner'`, `'editor'`, or `'viewer'`.                                              |
| `AccessDecision`                  | interface | Result of a permission check (`allowed`, `permission`, optional role/resource).    |
| `SessionContext`                  | interface | Current session: user, provider, workspace, role, entitlements, expiry.            |
| `SyncScopePayload`                | interface | Sync scope (`workspaceId`, optional `projectId`).                                  |
| `SyncPendingOpPayload`            | interface | Outbox operation awaiting push (table, primary key, HLC stamp, retry state).       |
| `NotificationAction`              | interface | Clickable action on a notification (`navigate` or `callback`).                     |
| `NotificationCreatePayload`       | interface | Input shape for `notify:action:push` (title, type, optional actions).              |
| `NotificationEntity`              | interface | Stored notification row (user scope, read state, clocks).                          |
| `StorageFileUploadBeforePayload`  | interface | Pre-upload context (hash, workspace, size).                                        |
| `StorageFileUploadAfterPayload`   | interface | Post-upload result (hash, workspace, storage id).                                  |
| `StorageFileDownloadBeforePayload`| interface | Pre-download context (hash, workspace).                                            |
| `StorageFileDownloadAfterPayload` | interface | Post-download result (hash, workspace, size).                                      |
| `StorageFileUrlOptionsPayload`    | interface | Presigned URL options (hash, expiry, disposition).                                 |
| `StorageFileUploadPolicyPayload`  | interface | Upload policy input (hash, mime type, size).                                       |
| `StorageFileGcPayload`            | interface | Garbage collection result (deleted count, workspace).                              |

```ts
// Source: app/core/hooks/hook-domain-types.ts
export type Permission =
    | 'workspace.read'
    | 'workspace.write'
    | 'workspace.settings.manage'
    | 'users.manage'
    | 'plugins.manage'
    | 'admin.access';

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface AccessDecision {
    allowed: boolean;
    permission: Permission;
    reason?: string;
    userId?: string;
    workspaceId?: string;
    role?: WorkspaceRole;
    resource?: { kind: string; id?: string };
}

export interface SessionContext {
    authenticated: boolean;
    provider?: string;
    providerUserId?: string;
    user?: { id: string; email?: string; displayName?: string };
    workspace?: { id: string; name: string };
    role?: WorkspaceRole;
    expiresAt?: string;
    authorizationRevision?: number;
    deploymentAdmin?: boolean;
    entitlements?: string[];
}

export interface SyncScopePayload {
    workspaceId: string;
    projectId?: string;
}

export interface SyncPendingOpPayload {
    id: string;
    tableName: string;
    operation: 'put' | 'delete';
    pk: string;
    payload?: unknown;
    stamp: {
        deviceId: string;
        opId: string;
        hlc: string;
        clock: number;
    };
    createdAt: number;
    attempts: number;
    nextAttemptAt?: number;
    status:
        | 'pending'
        | 'in_flight'
        | 'retry_wait'
        | 'failed_retryable'
        | 'failed_permanent'
        | 'applied'
        | 'discarded'
        | 'syncing'
        | 'failed';
}

export interface NotificationAction {
    id: string;
    label: string;
    kind: 'navigate' | 'callback';
    target?: {
        threadId?: string;
        documentId?: string;
        route?: string;
    };
    data?: Record<string, unknown>;
}

export interface NotificationCreatePayload {
    type: string;
    title: string;
    body?: string;
    threadId?: string;
    documentId?: string;
    actions?: NotificationAction[];
}

export interface NotificationEntity {
    id: string;
    workspace_id?: string;
    user_id: string;
    thread_id?: string;
    document_id?: string;
    type: string;
    title: string;
    body?: string;
    actions?: NotificationAction[];
    read_at?: number;
    deleted: boolean;
    deleted_at?: number;
    created_at: number;
    updated_at: number;
    clock: number;
}

export interface StorageFileUploadBeforePayload {
    hash: string;
    workspace_id: string;
    size_bytes: number;
}

export interface StorageFileUploadAfterPayload {
    hash: string;
    workspace_id: string;
    storage_id: string;
}

export interface StorageFileDownloadBeforePayload {
    hash: string;
    workspace_id: string;
}

export interface StorageFileDownloadAfterPayload {
    hash: string;
    workspace_id: string;
    size_bytes: number;
}

export interface StorageFileUrlOptionsPayload {
    hash: string;
    expiry_ms: number;
    disposition?: string;
}

export interface StorageFileUploadPolicyPayload {
    hash: string;
    mime_type: string;
    size_bytes: number;
}

export interface StorageFileGcPayload {
    deleted_count: number;
    workspace_id: string;
}
```

---

## Hook name families and DB literals

| Name                      | Kind             | Description                                                                                               |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `DbEntityName`            | union            | Valid entity literals for DB hooks (`'messages'`, `'threads'`, …).                                        |
| `DbOperation`             | union            | Supported DB operations (`'create'`, `'upsert'`, `'update'`, `'delete'`, `'get'`, `'search'`, `'byProject'`, `'children'`, `'fork'`, `'normalize'`, `'list'`). |
| `DbPhase`                 | union            | `'before'` or `'after'` lifecycle for action hooks.                                                       |
| `DbDeleteType`            | union            | Distinguishes `'soft'` vs `'hard'` delete hooks.                                                          |
| `DbActionHookName`        | template literal | Enumerates action hook naming convention across DB families (`db.posts.delete:action:soft:before`, etc.). |
| `DbFilterHookName`        | template literal | Enumerates filter hook naming convention (`db.messages.create:filter:input`, etc.).                       |
| `CoreActionHookName`      | conditional      | Extracts built-in action hook keys from `CoreHookPayloadMap`.                                             |
| `ExtensionActionHookName` | alias            | `keyof Or3ActionHooks`; supports module augmentation.                                                     |
| `ActionHookName`          | union            | Combines core and extension action hook names.                                                            |
| `CoreFilterHookName`      | conditional      | Extracts built-in filter hook keys from `CoreHookPayloadMap`.                                             |
| `ExtensionFilterHookName` | alias            | `keyof Or3FilterHooks`; extension hook keys.                                                              |
| `FilterHookName`          | union            | Combines core and extension filter names.                                                                 |
| `HookName`                | union            | Full set of action + filter names.                                                                        |

---

## Payload maps and inference helpers

| Name                              | Kind          | Description                                                                                       |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `CoreHookPayloadMap`              | type literal   | Master mapping from built-in hook names to argument tuples; foundation for inference.             |
| `HookPayloadMap`                  | intersection  | `CoreHookPayloadMap` combined with developer augmentations via `Or3ActionHooks`/`Or3FilterHooks`. |
| `InferHookParams<K>`              | conditional   | Resolves the argument tuple for hook name `K`.                                                    |
| `InferHookReturn<K>`              | conditional   | Infers the expected return type for hook `K` (void for actions, chained value for filters).       |
| `InferHookCallback<K>`            | function type | Convenience signature for callbacks keyed by `K`.                                                 |
| `IsAction<K>`                     | conditional   | Type predicate that narrows `true` when `K` is an action hook.                                    |
| `IsFilter<K>`                     | conditional   | Type predicate for filter hook names.                                                             |
| `ExtractHookPayload<K>`           | conditional   | Pulls the payload tuple for hook `K`.                                                             |
| `MatchingHooks<Pattern>`          | conditional   | Extracts hook names that match a template literal pattern.                                        |
| `InferDbEntity<K>`                | conditional   | Infers the DB entity type represented by a hook key (e.g. `db.messages.*`).                       |
| `InferDbCreateEntity<K>`         | conditional   | Infers the create-input entity type for create hooks (e.g. `MessageCreateEntity`).                |
| `Tail<T>`                         | alias         | Removes the first element from a tuple (`T extends [unknown, ...infer Rest] ? Rest : []`).         |
| `SuggestSimilar<K>`               | conditional   | Produces human-readable suggestions for invalid hook keys during type checking.                   |
| `ValidateHookName<K>`             | conditional   | Emits helpful diagnostics when a hook name is invalid.                                            |
| `TypeName<T>`                     | conditional   | Friendly string literal describing the TypeScript type `T`.                                       |
| `CallbackMismatch<Expected, Got>` | conditional   | Diagnostic helper that compares expected vs actual callback signatures.                           |

---

## Usage notes

-   The hook engine exposes runtime APIs via `HookEngine` while `TypedHookEngine` wraps them for inference. Use `useHooks()` to obtain the typed variant.
-   When adding new hook keys, update `KnownHookKey` and `CoreHookPayloadMap` (plus the relevant payload interfaces) so documentation and inference stay aligned.
-   Generics like `InferHookParams` and `MatchingHooks` power helper utilities and schema validation—reference them when building tooling around the hook system.
