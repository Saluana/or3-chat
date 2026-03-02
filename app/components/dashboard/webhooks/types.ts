export type ManagedWebhookScope = 'user' | 'admin';
export type ManagedWebhookHealth = 'healthy' | 'failing' | 'unknown';

export interface ManagedWebhook {
    id: string;
    scope: ManagedWebhookScope;
    user_id: string | null;
    workspace_id: string | null;
    url: string;
    label: string;
    events: string[];
    custom_hooks: string[];
    enabled: boolean;
    health: ManagedWebhookHealth;
    created_at: number;
    updated_at: number;
}

export interface ManagedWebhookLog {
    id: string;
    webhook_id: string;
    event_id: string;
    event_type: string;
    attempt: number;
    status: 'pending' | 'in_flight' | 'success' | 'failed' | 'cancelled';
    http_status: number | null;
    error_message: string | null;
    request_payload: string;
    response_body: string | null;
    duration_ms: number | null;
    created_at: number;
}

export interface ManagedWebhookTestResult {
    webhookId: string;
    success: boolean;
    statusCode: number | null;
    durationMs: number;
    error: string | null;
    responseBody?: string | null;
}

export interface ManagedWorkspaceOption {
    id: string;
    name: string;
}
