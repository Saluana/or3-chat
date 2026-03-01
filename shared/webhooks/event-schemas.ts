export interface ThreadEventData {
    id: string;
    title?: string | null;
    status?: string | null;
    deleted?: boolean;
    pinned?: boolean;
    created_at?: number;
    updated_at?: number;
}

export interface MessageEventData {
    id: string;
    thread_id: string;
    role?: string | null;
    content?: string | null;
    deleted?: boolean;
    index?: number;
    order_key?: string | null;
    created_at?: number;
    updated_at?: number;
}

export interface DocumentEventData {
    id: string;
    title?: string | null;
    content_length?: number | null;
    deleted?: boolean;
    created_at?: number;
    updated_at?: number;
}

export interface NotificationEventData {
    id: string;
    user_id: string;
    thread_id?: string | null;
    document_id?: string | null;
    type?: string | null;
    title?: string | null;
    body?: string | null;
    read_at?: number | null;
    created_at?: number;
    updated_at?: number;
}

export interface MessageCompletedEventData {
    thread_id: string;
    message_id: string;
    model_id?: string | null;
    job_id?: string | null;
    completed_at?: string | null;
}

export interface AdminUserEventData {
    user_id: string;
    email?: string | null;
    role?: string | null;
    workspace_id?: string | null;
}

export interface AdminWorkspaceEventData {
    workspace_id: string;
    name?: string | null;
    slug?: string | null;
    deleted_at?: number | null;
}

export interface AdminPluginEventData {
    plugin_id: string;
    plugin_type?: string | null;
    version?: string | null;
    workspace_id?: string | null;
}

export interface AdminErrorEventData {
    source: 'sync' | 'storage' | string;
    message: string;
    code?: string | null;
    workspace_id?: string | null;
    details?: Record<string, unknown> | null;
}

export interface AdminJobEventData {
    job_id: string;
    status: 'completed' | 'failed';
    workspace_id?: string | null;
    user_id?: string | null;
    thread_id?: string | null;
    message_id?: string | null;
    error?: string | null;
}

export type UserWebhookEventData =
    | ThreadEventData
    | MessageEventData
    | DocumentEventData
    | NotificationEventData
    | MessageCompletedEventData;

export type AdminWebhookEventData =
    | AdminUserEventData
    | AdminWorkspaceEventData
    | AdminPluginEventData
    | AdminErrorEventData
    | AdminJobEventData;

export type AnyWebhookEventData = UserWebhookEventData | AdminWebhookEventData;
