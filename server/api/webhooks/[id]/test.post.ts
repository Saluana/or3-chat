import {
    createWebhookRouteDispatcher,
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
    requireWebhookSigningSecret,
} from '../_helpers';
import { createWebhookTestHandler } from '../route-factories';

export default createWebhookTestHandler({
    getWebhookId: requireWebhookId,
    resolveContext(event) {
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
    createDispatcher: createWebhookRouteDispatcher,
    getSigningSecret: requireWebhookSigningSecret,
});
