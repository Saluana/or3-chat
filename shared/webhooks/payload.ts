import type { AnyWebhookEventData } from './event-schemas';
import type { WebhookScope } from './event-types';

export interface WebhookPayload<TData = AnyWebhookEventData> {
    event: string;
    event_id: string;
    timestamp: string;
    workspace_id?: string | null;
    user_id?: string | null;
    scope?: WebhookScope;
    data: TData;
}
