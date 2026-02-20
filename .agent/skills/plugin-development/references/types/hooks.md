# Hooks types

Canonical reference for every exported TypeScript type and interface that powers the hook engine. All definitions come from `app/core/hooks/**/*.ts` and are grouped by concern so you can locate payload shapes, key unions, and helper generics quickly.

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
// Source: app/core/hooks/hooks.ts
export type HookKind = 'action' | 'filter';

export interface RegisterOptions {
    priority?: number;
    acceptedArgs?: number;
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

export type HookFn = (...args: any[]) => any;

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
    applyFilters<T>(name: string, value: T, ...args: any[]): Promise<T>;
    applyFiltersSync<T>(name: string, value: T, ...args: any[]): T;

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
    doAction(name: string, ...args: any[]): Promise<void>;
    doActionSync(name: string, ...args: any[]): void;

    hasFilter(name?: string, fn?: (...args: any[]) => any): boolean | number;
    hasAction(name?: string, fn?: (...args: any[]) => any): boolean | number;
    removeAllCallbacks(priority?: number): void;
    currentPriority(): number | false;

    onceAction(
        name: string,
        fn: (...args: any[]) => any,
        priority?: number
    ): () => void;
    on(name: string, fn: (...args: any[]) => any, opts?: OnOptions): () => void;
    off(disposer: () => void): void;

    _diagnostics: {
        timings: Record<string, number[]>;
        errors: Record<string, number>;
        callbacks(actionOrFilter?: HookKind): number;
    };
}

// Source: app/core/hooks/typed-hooks.ts
type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : [];

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
| `KnownHookKey`             | union            | Enumerates high-signal hook names (`ui.chat.message:filter:outgoing`, `ai.chat.send:action:before`, …) for first-class editor autocomplete.   |
| `DbFamily`                 | union            | Database table families (`'messages'`, `'documents'`, `'files'`, `'threads'`, `'projects'`, `'posts'`, `'prompts'`, `'attachments'`, `'kv'`). |
| `DbHookKey`                | template literal | Forms `db.${DbFamily}.${string}` for flexible DB hook addressing.                                                                             |
| `HookKey`                  | union            | Final public key type combining `KnownHookKey`, `DbHookKey`, and an open string fallback for plugins.                                         |
| `HookPayloads`             | interface        | Maps each `KnownHookKey` to its listener argument tuple (e.g. `'ui.pane.thread:filter:select'` → `[requestedId, pane, previousId]`).          |
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
    | 'files.attach:filter:input';

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

export interface HookPayloads {
    'ai.chat.send:action:before': [AiSendBeforePayload];
    'ai.chat.send:action:after': [AiSendAfterPayload];
    'ai.chat.stream:action:delta': [string, AiStreamDeltaPayload];
    'ai.chat.stream:action:reasoning': [string, AiStreamReasoningPayload];
    'ai.chat.stream:action:complete': [AiStreamCompletePayload];
    'ai.chat.stream:action:error': [AiStreamErrorPayload];
    'ui.pane.msg:action:sent': [UiPaneMsgSentPayload];
    'ui.pane.msg:action:received': [UiPaneMsgReceivedPayload];
    'ui.pane.active:action': [UiPaneActivePayload];
    'ui.pane.blur:action': [UiPaneBlurPayload];
    'ui.pane.switch:action': [UiPaneSwitchPayload];
    'ui.pane.thread:filter:select': [
        string,
        UiPaneThreadChangedPayload['pane'],
        string
    ];
    'ui.pane.thread:action:changed': [UiPaneThreadChangedPayload];
    'ui.pane.doc:filter:select': [
        string,
        UiPaneDocChangedPayload['pane'],
        string
    ];
    'ui.pane.doc:action:changed': [UiPaneDocChangedPayload];
    'ui.pane.doc:action:saved': [UiPaneDocChangedPayload];
    'ui.chat.message:filter:outgoing': [string];
    'ui.chat.message:filter:incoming': [string, string | undefined];
    'ai.chat.model:filter:select': [string];
    'ai.chat.messages:filter:input': [any[]];
    'files.attach:filter:input': [FilesAttachInputPayload | false];
    'ai.chat.retry:action:before': [AiRetryBeforePayload];
    'ai.chat.retry:action:after': [AiRetryAfterPayload];
}

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
    nuxtApp: any;
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
    value: any;
}
```

---

## Entity mirrors and DB payload wrappers

| Name                 | Kind      | Description                                                                                |
| -------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `MessageEntity`      | interface | Hook-friendly projection of a message row (`id`, `thread_id`, `role`, `data`, timestamps). |
| `ThreadEntity`       | interface | Thread metadata consumed by hooks (status, branching info, clock).                         |
| `DocumentEntity`     | interface | Document metadata for hooks (title, content, timestamps).                                  |
| `FileEntity`         | interface | File metadata (`hash`, `name`, `mime`, `size`, reference count).                           |
| `ProjectEntity`      | interface | Project record summary (name, description, clock flags).                                   |
| `PostEntity`         | interface | Lightweight post/blog record.                                                              |
| `PromptEntity`       | interface | Prompt data (`id`, `name`, `text`).                                                        |
| `AttachmentEntity`   | interface | Attachment record linking messages to files.                                               |
| `KvEntry`            | interface | Key-value store record (name/value, clocks, timestamps).                                   |
| `DbCreatePayload<T>` | interface | Generic wrapper emitted before/after `create` operations (`entity`, `tableName`).          |
| `DbUpdatePayload<T>` | interface | Wrapper for update lifecycle (existing, updated, patch, table).                            |
| `DbDeletePayload<T>` | interface | Wrapper for delete lifecycle (entity, id, table).                                          |

---

### TypeScript reference

```ts
// Source: app/core/hooks/hook-types.ts
export interface MessageEntity {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant' | 'system';
    data: any;
    index: number;
    created_at: number;
    updated_at?: number;
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

export interface DocumentEntity {
    id: string;
    title?: string;
    content?: string;
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
    data: any;
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

export interface PromptEntity {
    id: string;
    name: string;
    text: string;
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

export interface DbCreatePayload<T = any> {
    entity: T;
    tableName: string;
}

export interface DbUpdatePayload<T = any> {
    existing: T;
    updated: T;
    patch: Partial<T>;
    tableName: string;
}

export interface DbDeletePayload<T = any> {
    entity: T;
    id: string;
    tableName: string;
}
```

---

## Hook name families and DB literals

| Name                      | Kind             | Description                                                                                               |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `DbEntityName`            | union            | Valid entity literals for DB hooks (`'messages'`, `'threads'`, …).                                        |
| `DbOperation`             | union            | Supported DB operations (`'create'`, `'update'`, `'delete'`, `'get'`, `'search'`, `'normalize'`, etc.).   |
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
| `CoreHookPayloadMap`              | mapped type   | Master mapping from built-in hook names to argument tuples; foundation for inference.             |
| `HookPayloadMap`                  | intersection  | `CoreHookPayloadMap` combined with developer augmentations via `Or3ActionHooks`/`Or3FilterHooks`. |
| `InferHookParams<K>`              | conditional   | Resolves the argument tuple for hook name `K`.                                                    |
| `InferHookReturn<K>`              | conditional   | Infers the expected return type for hook `K` (void for actions, chained value for filters).       |
| `InferHookCallback<K>`            | function type | Convenience signature for callbacks keyed by `K`.                                                 |
| `IsAction<K>`                     | conditional   | Type predicate that narrows `true` when `K` is an action hook.                                    |
| `IsFilter<K>`                     | conditional   | Type predicate for filter hook names.                                                             |
| `ExtractHookPayload<K>`           | conditional   | Pulls the payload tuple for hook `K`.                                                             |
| `MatchingHooks<Pattern>`          | conditional   | Extracts hook names that match a template literal pattern.                                        |
| `InferDbEntity<K>`                | conditional   | Infers the DB entity type represented by a hook key (e.g. `db.messages.*`).                       |
| `Tail<T>`                         | alias         | Removes the first element from a tuple (`T extends [any, ...infer Rest] ? Rest : []`).            |
| `SuggestSimilar<K>`               | conditional   | Produces human-readable suggestions for invalid hook keys during type checking.                   |
| `ValidateHookName<K>`             | conditional   | Emits helpful diagnostics when a hook name is invalid.                                            |
| `TypeName<T>`                     | conditional   | Friendly string literal describing the TypeScript type `T`.                                       |
| `CallbackMismatch<Expected, Got>` | conditional   | Diagnostic helper that compares expected vs actual callback signatures.                           |

---

## Usage notes

-   The hook engine exposes runtime APIs via `HookEngine` while `TypedHookEngine` wraps them for inference. Use `useHooks()` to obtain the typed variant.
-   When adding new hook keys, update `HookPayloads` and the relevant payload interfaces so documentation and inference stay aligned.
-   Generics like `InferHookParams` and `MatchingHooks` power helper utilities and schema validation—reference them when building tooling around the hook system.
