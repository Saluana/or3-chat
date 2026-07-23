/**
 * Data contracts shared by hook payloads.
 *
 * These interfaces deliberately contain no hook-name or callback machinery.
 * Keeping domain records separate prevents the hook registry's type-level
 * mapping from becoming the owner of every database and service shape.
 */

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
    reason?:
        | 'unauthenticated'
        | 'forbidden'
        | 'unknown-permission'
        | (string & {});
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
