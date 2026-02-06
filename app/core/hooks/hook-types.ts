/**
 * @module app/core/hooks/hook-types.ts
 *
 * Purpose:
 * Comprehensive type system for the OR3 hook engine. Provides compile-time
 * type safety for hook names, payloads, callbacks, and return types.
 * Runtime behavior is unchanged; all definitions here are types-only.
 *
 * Responsibilities:
 * - Define payload interfaces for all core hooks (AI, UI, Pane, Sync, Storage, etc.)
 * - Define DB entity types used in hook payloads
 * - Define template-literal hook name types for DB hooks
 * - Provide `HookPayloadMap` mapping hook names to their parameter tuples
 * - Provide utility types: `InferHookParams`, `InferHookReturn`, `InferHookCallback`
 * - Support plugin augmentation via `Or3ActionHooks` / `Or3FilterHooks` global interfaces
 * - Provide developer-friendly error diagnostics via `ValidateHookName` / `SuggestSimilar`
 *
 * Non-responsibilities:
 * - Runtime hook dispatch (see hooks.ts)
 * - Component lifecycle (see useHookEffect / useHooks)
 *
 * Constraints:
 * - Keep expansions small and additive to avoid TS performance degradation
 * - Payload interfaces should use plain data types (no Vue reactivity, no class instances)
 * - Wire-format fields use snake_case (aligned with Dexie and sync layer)
 *
 * @see core/hooks/hooks.ts for the runtime engine
 * @see core/hooks/hook-keys.ts for the known hook key unions
 * @see docs/core-hook-map.md for the human-readable hook reference
 */
import type { PaneState as MultiPaneState } from '../../composables/core/useMultiPane';
import type { ChatMessage } from '~/utils/chat/types';
import type { ORMessage } from '~/core/auth/openrouter-build';
import type { WorkflowStreamingState } from '~/composables/chat/useWorkflowStreamAccumulator';

export interface EditorInstance {
    commands: Record<string, unknown>;
    getJSON: () => Record<string, unknown>;
}

export type OpenRouterMessage =
    | ORMessage
    | {
          role: 'tool';
          [key: string]: unknown;
      };

/**
 * Overview
 * - Strongly-typed hook names (actions and filters)
 * - Payload interfaces with clear shapes for AI, UI, Pane, and DB hooks
 * - Utility types to infer callback signatures and returns
 * - Helpful error helper types for clearer TS diagnostics
 */
// ============================================================================

// Chat & AI Hooks
/**
 * Context provided right before an AI send call is executed.
 */
export interface AiSendBeforePayload {
    threadId?: string;
    modelId: string;
    user: { id: string; length: number };
    assistant: { id: string; streamId: string };
    messagesCount?: number;
}

/** Timing breakdown for an AI send request. */
export interface AiSendAfterPayloadTimings {
    startedAt: number;
    endedAt: number;
    durationMs: number;
}

/**
 * Context provided after an AI send completes (or aborts).
 */
export interface AiSendAfterPayload {
    threadId?: string;
    request?: { modelId?: string; userId?: string };
    response?: { assistantId?: string; length?: number };
    timings?: AiSendAfterPayloadTimings;
    aborted?: boolean;
}

/** Streaming token delta context. */
export interface AiStreamDeltaContext {
    threadId?: string;
    assistantId: string;
    streamId: string;
    deltaLength: number;
    totalLength: number;
    chunkIndex: number;
}

/** Streaming reasoning delta context. */
export interface AiStreamReasoningContext {
    threadId?: string;
    assistantId: string;
    streamId: string;
    reasoningLength: number;
}

/** Final streaming completion context. */
export interface AiStreamCompleteContext {
    threadId?: string;
    assistantId: string;
    streamId: string;
    totalLength: number;
    reasoningLength?: number;
    fileHashes?: string | null;
}

/** Stream error context (includes aborts). */
export interface AiStreamErrorContext {
    threadId?: string;
    streamId?: string;
    error?: unknown;
    aborted?: boolean;
}

// Aliases with the names used in the task list
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

// Pane Hooks
/** Current UI pane state (reuses the core MultiPane definition). */
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

// Named pane payloads used by typed composables and docs
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
    oldThreadId: string;
    newThreadId: string;
    paneIndex: number;
    messageCount?: number;
}

export interface UiPaneDocChangedPayload {
    pane: PaneState;
    oldDocumentId: string;
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

// UI / Sidebar
/** Sidebar selection payload (chat vs doc). */
export interface UiSidebarSelectPayload {
    kind: 'chat' | 'doc';
    id: string;
}

export interface UiChatNewPayload {
    threadId?: string;
    createdAt?: number;
}

export interface AppInitPayload {
    nuxtApp: unknown; // kept opaque to avoid heavy imports
}

export interface FilesAttachPayload extends FilesAttachInputPayload {
    accepted: boolean;
    url?: string;
    hash?: string;
}

// File attachment filter payload
/** Input payload for file attach filter; return false to reject. */
export interface FilesAttachInputPayload {
    file: File;
    name: string;
    mime: string;
    size: number;
    kind: 'image' | 'pdf';
}

// ============================================================================
// BRANCHING — payloads & helpers
// ============================================================================

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

/** Optional helper for KV upsert-by-name payloads. */
export interface KvUpsertByNameInput {
    name: string;
    value: unknown;
}

// ============================================================================
// DB ENTITY TYPES (lightweight — expand incrementally as needed)
// ============================================================================

/** DB entity: message */
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

/** DB entity: message create input */
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

/** DB entity: thread */
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

/** DB entity: thread create input */
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

/** DB entity: document */
export interface DocumentEntity {
    id: string;
    title?: string;
    content?: string;
    created_at?: number;
    updated_at?: number;
}

/** DB entity: file */
export interface FileEntity {
    hash: string;
    name: string;
    mime: string;
    size: number;
    ref_count?: number;
}

/** DB entity: project */
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

/** DB entity: post */
export interface PostEntity {
    id: string;
    title?: string;
    body?: string;
    created_at?: number;
    updated_at?: number;
}

/** DB entity: post create input */
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

/** DB entity: prompt */
export interface PromptEntity {
    id: string;
    name: string;
    text: string;
}

/** DB entity: attachment */
export interface AttachmentEntity {
    id: string;
    message_id?: string;
    file_hash?: string;
}

/** DB entity: key-value entry */
export interface KvEntry {
    id: string;
    name: string;
    value?: string | null;
    created_at: number;
    updated_at: number;
    clock: number;
}

// ============================================================================
// AUTH TYPES
// ============================================================================

/** Auth permission model. */
export type Permission =
    | 'workspace.read'
    | 'workspace.write'
    | 'workspace.settings.manage'
    | 'users.manage'
    | 'plugins.manage'
    | 'admin.access';

/** Workspace membership role. */
export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

/** Authorization decision returned by can(). */
export interface AccessDecision {
    allowed: boolean;
    permission: Permission;
    reason?: 'unauthenticated' | 'forbidden' | 'unknown-permission';
    userId?: string;
    workspaceId?: string;
    role?: WorkspaceRole;
    resource?: { kind: string; id?: string };
}

/** Server-side session context resolved from auth provider. */
export interface SessionContext {
    authenticated: boolean;
    provider?: string;
    providerUserId?: string;
    user?: { id: string; email?: string; displayName?: string };
    workspace?: { id: string; name: string };
    role?: WorkspaceRole;
    expiresAt?: string;
    /**
     * Indicates if this user has deployment-wide admin access.
     * Set by the canonical store based on admin_users table.
     */
    deploymentAdmin?: boolean;
}

// ============================================================================
// SYNC TYPES
// ============================================================================

/** Sync scope for workspace-scoped operations. */
export interface SyncScopePayload {
    workspaceId: string;
    projectId?: string;
}

/** Sync pending operation payload for hooks. */
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
    status: 'pending' | 'syncing' | 'failed';
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/** Notification action button/link configuration */
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

/** Payload for creating a notification via hooks */
export interface NotificationCreatePayload {
    type: string;
    title: string;
    body?: string;
    threadId?: string;
    documentId?: string;
    actions?: NotificationAction[];
}

/** Full notification entity from database */
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

// ============================================================================
// STORAGE TYPES
// ============================================================================

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

// Generic DB op payloads
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

// ============================================================================
// HOOK NAME TYPES
// ============================================================================

// Allow plugins to extend hook payloads via global augmentation (types-only)
declare global {
    interface Or3ActionHooks {} // e.g. { 'my.plugin.ready:action': [MyPayload] }

    interface Or3FilterHooks {} // e.g. { 'my.plugin.value:filter:transform': [InType] }
}
// Ensure this file is always a module so augmentation is picked up
export {};

// DB hook patterns
/** All DB table names that emit hooks. */
export type DbEntityName =
    | 'messages'
    | 'threads'
    | 'documents'
    | 'files'
    | 'projects'
    | 'posts'
    | 'prompts'
    | 'attachments'
    | 'kv';
/** All DB operations that can generate hooks. */
export type DbOperation =
    | 'create'
    | 'upsert'
    | 'update'
    | 'delete'
    | 'get'
    | 'search'
    | 'byProject'
    | 'children'
    | 'fork'
    | 'normalize'
    | 'list';
/** Hook execution phase for actions. */
export type DbPhase = 'before' | 'after';
export type DbDeleteType = 'soft' | 'hard';

/** Template literal names for DB action hooks. */
export type DbActionHookName =
    | `db.${DbEntityName}.${DbOperation}:action:${DbPhase}`
    | `db.${DbEntityName}.delete:action:${DbDeleteType}:${DbPhase}`
    // extra specialized actions seen in docs
    | `db.files.refchange:action:after`
    | `db.kv.upsertByName:action:after`
    | `db.kv.deleteByName:action:hard:${DbPhase}`;

/** Template literal names for DB filter hooks. */
export type DbFilterHookName =
    | `db.${DbEntityName}.${DbOperation}:filter:input`
    | `db.${DbEntityName}.${DbOperation}:filter:output`
    // extra specialized filters seen in docs
    | `db.messages.files.validate:filter:hashes`
    | `db.kv.getByName:filter:output`
    | `db.kv.upsertByName:filter:input`
    | `db.threads.searchByTitle:filter:output`
    | `db.posts.all:filter:output`;

// Action hooks (fire-and-forget)
/**
 * Action hooks fire-and-forget. Callbacks return void or Promise<void>.
 * Derived from payload map keys to ensure suggestions always exist.
 * @see FilterHookName for value-transforming hooks.
 */
export type CoreActionHookName = Extract<
    keyof CoreHookPayloadMap,
    `${string}:action${string}`
>;
export type ExtensionActionHookName = keyof Or3ActionHooks;
// NOTE: ExtensionActionHookName is included for API consumers to extend via global augmentation.
// When Or3ActionHooks is empty, it resolves to `never` which is intentionally left out of the
// union until it's augmented with actual keys.
export type ActionHookName =
    | CoreActionHookName
    | DbActionHookName
    | ExtensionActionHookName
    | (string & {});

// Filter hooks (value-in → value-out)
/**
 * Filter hooks transform values. Callbacks must return the filtered value.
 * Derived from payload map keys to ensure suggestions always exist.
 * @see ActionHookName for fire-and-forget hooks.
 */
export type CoreFilterHookName = Extract<
    keyof CoreHookPayloadMap,
    `${string}:filter${string}`
>;
export type ExtensionFilterHookName = keyof Or3FilterHooks;
// NOTE: ExtensionFilterHookName is included for API consumers to extend via global augmentation.
// When Or3FilterHooks is empty, it resolves to `never` which is intentionally left out of the
// union until it's augmented with actual keys.
export type FilterHookName =
    | CoreFilterHookName
    | DbFilterHookName
    | ExtensionFilterHookName
    | (string & {});

// All hook names
/** All known hooks (actions + filters). */
export type HookName = ActionHookName | FilterHookName;

// ============================================================================
// HOOK PAYLOAD MAPPING — tuple of parameters per hook name
// ============================================================================

// Core (non-db) hook payloads. Keep explicit entries for commonly used hooks.
export type CoreHookPayloadMap = {
    // AI/Chat Actions
    'ai.chat.send:action:before': [AiSendBeforePayload];
    'ai.chat.send:action:after': [AiSendAfterPayload];
    'ai.chat.stream:action:delta': [string, AiStreamDeltaPayload];
    'ai.chat.stream:action:reasoning': [string, AiStreamReasoningPayload];
    'ai.chat.stream:action:complete': [AiStreamCompletePayload];
    'ai.chat.stream:action:error': [AiStreamErrorPayload];
    'ai.chat.retry:action:before': [AiRetryBeforePayload];
    'ai.chat.retry:action:after': [AiRetryAfterPayload];

    // Pane Actions (now use named payloads)
    'ui.pane.active:action': [UiPaneActivePayload];
    'ui.pane.blur:action': [UiPaneBlurPayload];
    'ui.pane.switch:action': [UiPaneSwitchPayload];
    'ui.pane.open:action:after': [UiPaneActivePayload];
    'ui.pane.close:action:before': [UiPaneActivePayload];
    'ui.pane.close:action:after': [UiPaneActivePayload];
    'ui.pane.thread:action:changed': [UiPaneThreadChangedPayload];
    'ui.pane.doc:action:changed': [UiPaneDocChangedPayload];
    'ui.pane.doc:action:saved': [UiPaneDocChangedPayload];
    'ui.pane.msg:action:sent': [UiPaneMsgSentPayload];
    'ui.pane.msg:action:received': [UiPaneMsgReceivedPayload];

    // Sidebar Actions
    'ui.sidebar.select:action:before': [UiSidebarSelectPayload];
    'ui.sidebar.select:action:after': [UiSidebarSelectPayload];
    'ui.chat.new:action:after': [UiChatNewPayload];

    // App Actions
    'app.init:action:after': [AppInitPayload];

    // Chat Filters
    'ui.chat.message:filter:outgoing': [string];
    'ui.chat.message:filter:incoming': [string, string | undefined];
    'ai.chat.model:filter:select': [string];
    'ai.chat.messages:filter:input': [ChatMessage[]];

    // Pane Filters
    'ui.pane.thread:filter:select': [string, PaneState, string];
    'ui.pane.doc:filter:select': [string, PaneState, string];

    // Files Filters
    'files.attach:filter:input': [FilesAttachInputPayload | false];

    // Small, well-known DB-specialized hooks kept explicit
    'db.messages.files.validate:filter:hashes': [string[]];
    'db.files.refchange:action:after': [
        { before: FileEntity; after: FileEntity; delta: number }
    ];
    'db.threads.getSystemPrompt:filter:output': [string | null];

    // Editor Lifecycle (Examples/Plugins)
    'editor.created:action:after': [{ editor: unknown }];
    'editor.updated:action:after': [{ editor: unknown }];
    'editor:request-extensions': [void];

    // UI/Chat Extensions
    'ui.chat.editor:filter:extensions': [unknown[]];
    'ui.chat.editor:action:before_send': [Record<string, unknown>]; // editor JSON
    'ai.chat.messages:filter:before_send': [
        { messages: OpenRouterMessage[] } | { messages: OpenRouterMessage[] }[]
    ];

    // Branching lifecycle
    'branch.fork:filter:options': [BranchForkOptions];
    'branch.fork:action:before': [BranchForkBeforePayload];
    'branch.fork:action:after': [ThreadEntity];
    'branch.retry:filter:options': [RetryBranchParams];
    'branch.retry:action:before': [
        {
            assistantMessageId: string;
            precedingUserId: string;
            mode: BranchMode;
        }
    ];
    'branch.retry:action:after': [
        {
            assistantMessageId: string;
            precedingUserId: string;
            newThreadId: string;
            mode: BranchMode;
        }
    ];
    'branch.context:filter:messages': [
        MessageEntity[],
        string /* threadId */,
        BranchMode
    ];
    'branch.context:action:after': [BranchContextAfterPayload];

    // Documents helpers
    'db.documents.title:filter': [
        string,
        {
            phase: 'create' | 'update';
            id: string;
            rawTitle?: string | null;
            existing?: DocumentEntity;
        }
    ];

    // Workflow Actions
    'workflow.execution:action:state_update': [
        { messageId: string; state: WorkflowStreamingState }
    ];
    'workflow.execution:action:complete': [
        { messageId: string; workflowId: string; finalOutput?: string }
    ];

    // Auth hooks
    'auth.access:filter:decision': [
        AccessDecision,
        { session: SessionContext | null }
    ];
    'auth.user:action:created': [{ userId: string; provider: string }];
    'auth.workspace:action:created': [{ workspaceId: string; userId: string }];

    // Storage hooks
    'storage.files.upload:action:before': [StorageFileUploadBeforePayload];
    'storage.files.upload:action:after': [StorageFileUploadAfterPayload];
    'storage.files.download:action:before': [StorageFileDownloadBeforePayload];
    'storage.files.download:action:after': [StorageFileDownloadAfterPayload];
    'storage.files.url:filter:options': [StorageFileUrlOptionsPayload];
    'storage.files.upload:filter:policy': [StorageFileUploadPolicyPayload | false];
    'storage.files.gc:action:run': [StorageFileGcPayload];
    'storage:action:error': [{ message?: string } & Record<string, unknown>];

    // Sync hooks
    'sync.op:action:captured': [{ op: SyncPendingOpPayload }];
    'sync.push:action:before': [{ scope: SyncScopePayload; count: number }];
    'sync.push:action:after': [
        { scope: SyncScopePayload; successCount: number; failCount: number }
    ];
    'sync.bootstrap:action:start': [{ scope: SyncScopePayload }];
    'sync.bootstrap:action:progress': [
        {
            scope: SyncScopePayload;
            cursor: number;
            pulledCount: number;
            hasMore: boolean;
        }
    ];
    'sync.bootstrap:action:complete': [
        { scope: SyncScopePayload; cursor: number; totalPulled: number }
    ];
    'sync.pull:action:received': [
        { scope: SyncScopePayload; changeCount: number }
    ];
    'sync.pull:action:applied': [
        {
            scope: SyncScopePayload;
            applied: number;
            skipped: number;
            conflicts: number;
        }
    ];
    'sync.pull:action:error': [{ scope: SyncScopePayload; error: string }];
    'sync.pull:action:after': [
        { scope: SyncScopePayload; count: number; cursor: number }
    ];
    'sync.subscription:action:statusChange': [
        {
            scope: SyncScopePayload;
            previousStatus: string;
            status: string;
        }
    ];
    'sync.conflict:action:detected': [
        {
            tableName: string;
            pk: string;
            local: unknown;
            remote: unknown;
            winner: 'local' | 'remote';
        }
    ];
    'sync.error:action': [{ op: SyncPendingOpPayload; error: unknown; permanent?: boolean }];
    'sync.retry:action': [{ op: SyncPendingOpPayload; attempt: number }];
    'sync.queue:action:full': [{ pendingCount: number; maxSize: number }];
    'sync.rescan:action:starting': [{ scope: SyncScopePayload }];
    'sync.rescan:action:progress': [{ scope: SyncScopePayload; progress: number }];
    'sync.rescan:action:completed': [{ scope: SyncScopePayload }];
    'sync.stats:action': [
        { pendingCount: number; cursor: number; lastSyncAt: number }
    ];
    'sync:action:error': [{ message?: string } & Record<string, unknown>];

    // Notification hooks
    'notify:action:push': [NotificationCreatePayload];
    'notify:action:read': [{ id: string; readAt: number }];
    'notify:action:clicked': [{ notification: NotificationEntity; action?: NotificationAction }];
    'notify:action:cleared': [{ count: number }];
    'notify:filter:before_store': [NotificationCreatePayload | false, { source: string }];
};

// Derived payloads for DB action hooks
type DbActionPayloadFor<K extends DbActionHookName> =
    K extends `db.${string}.${infer Op}:action:${string}`
        ? Op extends 'upsertByName'
            ? [InferDbEntity<K>]
            : Op extends 'deleteByName'
            ? [DbDeletePayload<InferDbEntity<K>>]
            : Op extends 'create' | 'upsert'
            ? [DbCreatePayload<InferDbEntity<K>>]
            : Op extends 'update'
            ? [DbUpdatePayload<InferDbEntity<K>>]
            : Op extends 'get'
            ? [{ id: string }]
            : Op extends 'search' | 'byProject' | 'children' | 'byThread'
            ? [{ query?: unknown }]
            : Op extends 'delete'
            ? K extends `db.${string}.delete:action:${string}:${string}`
                ? [DbDeletePayload<InferDbEntity<K>>]
                : [DbDeletePayload<InferDbEntity<K>>]
            : [unknown]
        : [unknown];

// Derived payloads for DB filter hooks
type DbFilterPayloadFor<K extends DbFilterHookName> =
    K extends `db.${string}.${infer Op}:filter:${infer Phase}`
        ? Phase extends 'input'
            ? Op extends 'create'
                ? [InferDbCreateEntity<K>]
                : Op extends 'upsert'
                ? [InferDbEntity<K>]
                : Op extends 'update'
                ? [DbUpdatePayload<InferDbEntity<K>>]
                : Op extends 'get'
                ? [string]
                : Op extends 'search' | 'byProject' | 'children'
                ? [{ query?: unknown }]
                : Op extends 'upsertByName'
                ? [KvUpsertByNameInput | InferDbEntity<K>]
                : [never]
            : Phase extends 'output'
            ? Op extends 'search' | 'byProject' | 'children' | 'byThread'
                ? [InferDbEntity<K>[]]
                : Op extends 'list' | 'searchByTitle' | 'all'
                ? [InferDbEntity<K>[]]
                : Op extends 'getByName' | 'get' | 'byStream'
                ? [InferDbEntity<K> | undefined]
                : [InferDbEntity<K>]
            : [unknown]
        : [unknown];

// Map all DB action/filter hook names to inferred payload tuples.
type DbActionMap = { [K in DbActionHookName]: DbActionPayloadFor<K> };
type DbFilterMap = { [K in DbFilterHookName]: DbFilterPayloadFor<K> };

// Final HookPayloadMap including core hooks and DB-derived hooks.
export type HookPayloadMap = CoreHookPayloadMap &
    DbActionMap &
    DbFilterMap &
    Or3ActionHooks &
    Or3FilterHooks;

// ============================================================================
// TYPE UTILITIES
// ============================================================================

// Extract callback parameters for a hook
/** Extract callback parameters for a hook name. */
export type InferHookParams<K extends HookName> = K extends keyof HookPayloadMap
    ? HookPayloadMap[K]
    : unknown[];

// Extract callback return type
/** Return type for a hook callback based on kind (action vs filter). */
export type InferHookReturn<K extends HookName> =
    K extends `${string}:filter${string}`
        ? K extends keyof HookPayloadMap
            ? HookPayloadMap[K][0]
            : unknown
        : void;

// Full callback signature
/** Full callback signature from a hook name. */
export type InferHookCallback<K extends HookName> = (
    ...args: InferHookParams<K>
) => InferHookReturn<K> | Promise<InferHookReturn<K>>;

// Kind checks
/** Type-level boolean: is an Action hook? */
export type IsAction<K extends HookName> = K extends ActionHookName
    ? true
    : false;
/** Type-level boolean: is a Filter hook? */
export type IsFilter<K extends HookName> = K extends FilterHookName
    ? true
    : false;

// Extract just the payload (first arg for filters; first tuple entry otherwise)
/** First parameter payload for a hook name (handy for actions). */
export type ExtractHookPayload<K extends HookName> =
    K extends keyof HookPayloadMap ? HookPayloadMap[K][0] : unknown;

// Wildcard support — basic pattern passthrough (kept simple for perf)
export type MatchingHooks<Pattern extends string> = Extract<
    HookName,
    `${Pattern}`
>;

// For DB hooks, infer entity type from name
export type InferDbEntity<K extends string> = K extends `db.messages.${string}`
    ? MessageEntity
    : K extends `db.threads.${string}`
    ? ThreadEntity
    : K extends `db.documents.${string}`
    ? DocumentEntity
    : K extends `db.files.${string}`
    ? FileEntity
    : K extends `db.projects.${string}`
    ? ProjectEntity
    : K extends `db.posts.${string}`
    ? PostEntity
    : K extends `db.prompts.${string}`
    ? PromptEntity
    : K extends `db.attachments.${string}`
    ? AttachmentEntity
    : K extends `db.kv.${string}`
    ? KvEntry
    : unknown;

// For DB create hooks, infer input entity type
export type InferDbCreateEntity<K extends string> =
    K extends `db.messages.${string}`
        ? MessageCreateEntity
        : K extends `db.posts.${string}`
        ? PostCreateEntity
        : K extends `db.threads.${string}`
        ? ThreadCreateEntity
        : InferDbEntity<K>;

// Utility: Tail of a tuple
export type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest]
    ? Rest
    : [];

// ==========================================================================
// ERROR UTILITIES — clearer TypeScript diagnostics for common mistakes
// ==========================================================================

/**
 * Suggest similar hooks by keeping the leftmost prefix before the first dot.
 * Example: ValidateHookName<'ai.chat.sennd:action:before'> produces candidates
 * like Extract<HookName, 'ai.chat.*'> in error tooltips.
 */
export type SuggestSimilar<K> = K extends `${infer Prefix}.${string}`
    ? Extract<HookName, `${Prefix}.${string}`>
    : HookName;

/**
 * Validate that a given name is a known HookName; otherwise emit a helpful string.
 */
export type ValidateHookName<K> = K extends HookName
    ? K
    : `Invalid hook name: ${Extract<
          K,
          string
      >}. Did you mean one of: ${SuggestSimilar<K>}`;

/**
 * Construct a descriptive message when a callback type doesn’t match expectations.
 */
// Stringified primitive typename helper used in error messages
export type TypeName<T> = T extends string
    ? 'string'
    : T extends number
    ? 'number'
    : T extends boolean
    ? 'boolean'
    : T extends bigint
    ? 'bigint'
    : T extends undefined
    ? 'undefined'
    : T extends null
    ? 'null'
    : T extends (...args: unknown[]) => unknown
    ? 'function'
    : T extends object
    ? 'object'
    : 'unknown';

export type CallbackMismatch<Expected, Got> =
    `Callback signature mismatch. Expected ${TypeName<Expected>}, got ${TypeName<Got>}`;

// Temporary dev guard to ensure hook names stay registered in types.

const __hook_name_checks__: [
    ValidateHookName<'branch.fork:filter:options'>,
    ValidateHookName<'branch.fork:action:before'>,
    ValidateHookName<'branch.fork:action:after'>,
    ValidateHookName<'branch.context:filter:messages'>,
    ValidateHookName<'branch.context:action:after'>,
    ValidateHookName<'db.documents.title:filter'>,
    ValidateHookName<'db.documents.list:filter:output'>,
    ValidateHookName<'db.kv.getByName:filter:output'>,
    ValidateHookName<'db.kv.upsertByName:filter:input'>,
    ValidateHookName<'db.kv.upsertByName:action:after'>,
    ValidateHookName<'db.kv.deleteByName:action:hard:before'>,
    ValidateHookName<'db.kv.deleteByName:action:hard:after'>,
    ValidateHookName<'db.threads.searchByTitle:filter:output'>,
    ValidateHookName<'db.posts.all:filter:output'>
] = [
    'branch.fork:filter:options',
    'branch.fork:action:before',
    'branch.fork:action:after',
    'branch.context:filter:messages',
    'branch.context:action:after',
    'db.documents.title:filter',
    'db.documents.list:filter:output',
    'db.kv.getByName:filter:output',
    'db.kv.upsertByName:filter:input',
    'db.kv.upsertByName:action:after',
    'db.kv.deleteByName:action:hard:before',
    'db.kv.deleteByName:action:hard:after',
    'db.threads.searchByTitle:filter:output',
    'db.posts.all:filter:output',
];

// Notes
// - Keep this file focused on public types and utilities.
// - Prefer small, additive expansions to avoid TS performance issues.
