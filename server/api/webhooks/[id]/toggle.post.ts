import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import {
    requireOwnedWebhook,
    requireWebhookApiContext,
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

    const { store, userId, workspaceId } = await requireWebhookApiContext(event);
    const webhookId = requireWebhookId(event);
    const existing = await requireOwnedWebhook(store, webhookId, userId, workspaceId);

    const updated = await store.updateWebhook(webhookId, {
        enabled: body.data.enabled ?? !existing.enabled,
    });

    return {
        webhook: serializeWebhook(updated),
    };
});
