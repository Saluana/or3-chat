import { defineEventHandler } from 'h3';
import { requireWebhookApiContext } from './_helpers';

export default defineEventHandler(async (event) => {
    const { store, userId, workspaceId } = await requireWebhookApiContext(
        event,
        'workspace.write'
    );
    const disabled = await store.disableAllWebhooks(userId, workspaceId);

    return {
        disabled,
    };
});
