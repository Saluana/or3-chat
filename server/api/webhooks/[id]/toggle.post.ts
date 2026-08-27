import {
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
    serializeWebhook,
} from '../_helpers';
import { createWebhookToggleHandler } from '../route-factories';

export default createWebhookToggleHandler({
    getWebhookId: requireWebhookId,
    async resolveContext(event) {
        return requireWebhookApiContext(event, 'workspace.write');
    },
    resolveWebhook(context, webhookId) {
        return requireOwnedWebhook(
            context.store,
            webhookId,
            context.userId,
            context.workspaceId
        );
    },
    serializeWebhook,
});
