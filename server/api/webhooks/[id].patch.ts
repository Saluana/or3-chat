import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from '../../../shared/webhooks/event-types';
import {
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
    serializeWebhook,
    validateWebhookTargetUrl,
} from './_helpers';

const BodySchema = z
    .object({
        url: z.string().min(1).optional(),
        label: z.string().max(100).optional(),
        events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: 'At least one field must be updated',
    });

export default defineEventHandler(async (event) => {
    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid request',
        });
    }

    const { store, userId, workspaceId } = await requireWebhookApiContext(
        event,
        'workspace.write'
    );
    const webhookId = requireWebhookId(event);
    const existing = await requireOwnedWebhook(store, webhookId, userId, workspaceId);

    if (body.data.url && body.data.url !== existing.url) {
        await validateWebhookTargetUrl(body.data.url);
    }

    const updated = await store.updateWebhook(webhookId, {
        url: body.data.url,
        label: body.data.label,
        events: body.data.events,
    });

    return {
        webhook: serializeWebhook(updated),
    };
});
