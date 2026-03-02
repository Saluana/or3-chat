import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import {
    refreshAdminWebhookListeners,
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
    serializeWebhook,
} from '../_helpers';

const BodySchema = z.object({
    enabled: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
    const body = BodySchema.safeParse((await readBody(event)) ?? {});
    if (!body.success) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid request',
        });
    }

    const { store } = await requireAdminWebhookApiContext(event, {
        mutation: true,
    });
    const webhookId = requireWebhookId(event);
    const existing = await requireAdminWebhook(store, webhookId);

    const updated = await store.updateWebhook(webhookId, {
        enabled: body.data.enabled ?? !existing.enabled,
    });

    await refreshAdminWebhookListeners();

    return {
        webhook: serializeWebhook(updated),
    };
});
