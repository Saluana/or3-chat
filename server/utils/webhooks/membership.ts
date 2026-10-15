import { useRuntimeConfig } from '#imports';
import { getAuthWorkspaceStore } from '../../auth/store/registry';
import { resolveWebhookStoreProviderId } from './store/resolve-store';
import type { WebhookRegistration, WebhookStore } from './store/types';

/** Recheck durable membership; session caches cannot authorize background work. */
export async function webhookHasCurrentAccess(store: WebhookStore, webhook: WebhookRegistration): Promise<boolean> {
    if (webhook.scope === 'admin') return true;
    const providerId = resolveWebhookStoreProviderId(useRuntimeConfig());
    const auth = providerId ? getAuthWorkspaceStore(providerId) : null;
    if (!auth) throw new Error('Webhook membership store is not configured');
    if (webhook.user_id && webhook.workspace_id && await auth.getWorkspaceRole({ userId: webhook.user_id, workspaceId: webhook.workspace_id })) {
        return true;
    }
    await store.updateWebhook(webhook.id, { enabled: false });
    await store.cancelDeliveriesByWebhook(webhook.id);
    return false;
}
