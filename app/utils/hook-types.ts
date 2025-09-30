// Hook & Plugin Type System — Core Types (non-breaking, types-only)
// This file provides compile-time types and utilities for amazing DX.
// Runtime behavior is unchanged: wrappers will delegate to the existing HookEngine.
/**
 * Overview
 * - Strongly-typed hook names (actions and filters)
 * - Payload interfaces with clear shapes for AI, UI, Pane, and DB hooks
 * - Utility types to infer callback signatures and returns
 * - Helpful error helper types for clearer TS diagnostics
 */

// ============================================================================
// PAYLOAD INTERFACES
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
/** Current UI pane state (minimal, SSR-safe). */
export interface PaneState {
    id: string;
    mode: 'chat' | 'doc';
    threadId?: string;
    documentId?: string;
    messages: any[];
    validating?: boolean;
}

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
    index: number;
}

export interface UiPaneSwitchPayload {
    pane: PaneState;
    index: number;
}

export interface UiPaneThreadChangedPayload {
    pane: PaneState;
    oldThreadId: string | '';
    newThreadId: string;
    paneIndex: number;
}

export interface UiPaneDocChangedPayload {
    pane: PaneState;
    oldDocumentId: string | '';
    newDocumentId: string;
}

export interface UiPaneMsgSentPayload {
    pane: PaneState;
    message: UiPaneMsgBase;
}

export interface UiPaneMsgReceivedPayload {
    pane: PaneState;
    message: UiPaneMsgReceived;
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
    nuxtApp: any; // kept opaque to avoid heavy imports; intentionally any
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
// DB ENTITY TYPES (lightweight — expand incrementally as needed)
// ============================================================================

/** DB entity: message */
export interface MessageEntity {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant' | 'system';
    data: any;
    index: number;
    created_at: number;
    updated_at?: number;
}

/** DB entity: thread */
export interface ThreadEntity {
    id: string;
    project_id?: string;
    title?: string;
    created_at: number;
    updated_at?: number;
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
    created_at?: number;
    updated_at?: number;
}

/** DB entity: post */
export interface PostEntity {
    id: string;
    title?: string;
    body?: string;
    created_at?: number;
    updated_at?: number;
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
    id?: number;
    name: string;
    value: any;
}

// Generic DB op payloads
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
    | 'normalize';
/** Hook execution phase for actions. */
export type DbPhase = 'before' | 'after';
export type DbDeleteType = 'soft' | 'hard';

/** Template literal names for DB action hooks. */
export type DbActionHookName =
    | `db.${DbEntityName}.${DbOperation}:action:${DbPhase}`
    | `db.${DbEntityName}.delete:action:${DbDeleteType}:${DbPhase}`
    // extra specialized actions seen in docs
    | `db.files.refchange:action:after`;

/** Template literal names for DB filter hooks. */
export type DbFilterHookName =
    | `db.${DbEntityName}.${DbOperation}:filter:input`
    | `db.${DbEntityName}.${DbOperation}:filter:output`
    // extra specialized filters seen in docs
    | `db.messages.files.validate:filter:hashes`;

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
    `${string}:filter:${string}`
>;
export type ExtensionFilterHookName = keyof Or3FilterHooks;
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
    'ai.chat.messages:filter:input': [any[]];

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
};

// Derived payloads for DB action hooks
type DbActionPayloadFor<K extends DbActionHookName> =
    K extends `db.${string}.${infer Op}:action:${string}`
        ? Op extends 'create' | 'upsert'
            ? [DbCreatePayload<InferDbEntity<K>>]
            : Op extends 'update'
            ? [DbUpdatePayload<InferDbEntity<K>>]
            : Op extends 'get'
            ? [{ id: string }]
            : Op extends 'search' | 'byProject' | 'children'
            ? [{ query?: any }]
            : Op extends 'delete'
            ? K extends `db.${string}.delete:action:${infer DeleteType}:${string}`
                ? [DbDeletePayload<InferDbEntity<K>>]
                : [DbDeletePayload<InferDbEntity<K>>]
            : [any]
        : [any];

// Derived payloads for DB filter hooks
type DbFilterPayloadFor<K extends DbFilterHookName> =
    K extends `db.${string}.${infer Op}:filter:${infer Phase}`
        ? Phase extends 'input'
            ? Op extends 'create' | 'upsert'
                ? [InferDbEntity<K>]
                : Op extends 'update'
                ? [DbUpdatePayload<InferDbEntity<K>>]
                : Op extends 'get'
                ? [string]
                : Op extends 'search' | 'byProject' | 'children'
                ? [{ query?: any }]
                : [any]
            : Phase extends 'output'
            ? Op extends 'search' | 'byProject' | 'children'
                ? [InferDbEntity<K>[]]
                : [InferDbEntity<K>]
            : [any]
        : [any];

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
    : any[];

// Extract callback return type
/** Return type for a hook callback based on kind (action vs filter). */
export type InferHookReturn<K extends HookName> = K extends FilterHookName
    ? K extends keyof HookPayloadMap
        ? HookPayloadMap[K][0]
        : any
    : void | Promise<void>;

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
    K extends keyof HookPayloadMap ? HookPayloadMap[K][0] : any;

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
    : any;

// Utility: Tail of a tuple
export type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : [];

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
    : T extends (...args: any[]) => any
    ? 'function'
    : T extends object
    ? 'object'
    : 'unknown';

export type CallbackMismatch<Expected, Got> =
    `Callback signature mismatch. Expected ${TypeName<Expected>}, got ${TypeName<Got>}`;

// Notes
// - Keep this file focused on public types and utilities.
// - Prefer small, additive expansions to avoid TS performance issues.
