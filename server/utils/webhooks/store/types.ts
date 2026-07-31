import type { WebhookScope } from '../../../../shared/webhooks/event-types';

export type WebhookHealth = 'healthy' | 'failing' | 'unknown';
export type WebhookDeliveryStatus =
    | 'pending'
    | 'in_flight'
    | 'success'
    | 'failed'
    | 'cancelled';

export interface WebhookRegistration {
    id: string;
    scope: WebhookScope;
    user_id: string | null;
    workspace_id: string | null;
    url: string;
    label: string;
    events: string[];
    custom_hooks: string[];
    signing_secret_enc: string;
    enabled: boolean;
    health: WebhookHealth;
    created_at: number;
    updated_at: number;
}

export interface WebhookDeliveryLog {
    id: string;
    webhook_id: string;
    event_id: string;
    event_type: string;
    attempt: number;
    status: WebhookDeliveryStatus;
    claimed_by: string | null;
    claimed_at: number | null;
    http_status: number | null;
    error_message: string | null;
    request_payload: string;
    response_body: string | null;
    duration_ms: number | null;
    next_retry_at: number | null;
    created_at: number;
}

export interface WebhookStore {
    createWebhook(
        webhook: Omit<
            WebhookRegistration,
            'id' | 'health' | 'created_at' | 'updated_at'
        >
    ): Promise<WebhookRegistration>;
    updateWebhook(
        webhookId: string,
        patch: Partial<
            Pick<
                WebhookRegistration,
                | 'url'
                | 'label'
                | 'events'
                | 'custom_hooks'
                | 'enabled'
                | 'workspace_id'
            >
        >
    ): Promise<WebhookRegistration>;
    deleteWebhook(webhookId: string): Promise<void>;
    getWebhook(webhookId: string): Promise<WebhookRegistration | null>;
    listWebhooks(userId: string, workspaceId: string): Promise<WebhookRegistration[]>;
    listAdminWebhooks(): Promise<WebhookRegistration[]>;
    listWebhooksByEvent(
        eventType: string,
        scope: WebhookScope,
        workspaceId?: string
    ): Promise<WebhookRegistration[]>;
    listWebhooksByCustomHook(hookName: string): Promise<WebhookRegistration[]>;
    listActiveCustomHookNames(): Promise<string[]>;
    updateWebhookHealth(webhookId: string, health: WebhookHealth): Promise<void>;
    disableAllWebhooks(userId: string, workspaceId: string): Promise<number>;

    createDeliveryLog(
        log: Omit<WebhookDeliveryLog, 'id'>
    ): Promise<WebhookDeliveryLog>;
    updateDeliveryLog(
        logId: string,
        patch: Partial<
            Pick<
                WebhookDeliveryLog,
                | 'status'
                | 'http_status'
                | 'error_message'
                | 'response_body'
                | 'duration_ms'
                | 'next_retry_at'
                | 'attempt'
            >
        >
    ): Promise<void>;
    getDeliveryLogs(webhookId: string, since: number): Promise<WebhookDeliveryLog[]>;
    getRecentTerminalDeliveries(
        webhookId: string,
        limit: number
    ): Promise<WebhookDeliveryLog[]>;

    claimPendingDeliveries(
        workerId: string,
        limit: number
    ): Promise<WebhookDeliveryLog[]>;
    resetStaleInFlightDeliveries(olderThanMs: number): Promise<number>;

    cancelDeliveriesByWebhook(webhookId: string): Promise<number>;
    deleteDeliveryLogsByWebhook(webhookId: string): Promise<number>;
    purgeExpiredLogs(beforeTimestamp: number): Promise<number>;
}
