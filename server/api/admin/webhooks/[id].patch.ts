import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import {
    ADMIN_WEBHOOK_EVENT_TYPES,
} from '../../../../shared/webhooks/event-types';
import {
    normalizeCustomHookNames,
    refreshAdminWebhookListeners,
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
    serializeWebhook,
    validateWebhookTargetUrl,
} from './_helpers';

const BodySchema = z
    .object({
        url: z.string().min(1).optional(),
        label: z.string().max(100).optional(),
        events: z.array(z.enum(ADMIN_WEBHOOK_EVENT_TYPES)).optional(),
        custom_hooks: z.array(z.string()).optional(),
        workspace_id: z.string().min(1).nullable().optional(),
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

    const { store } = await requireAdminWebhookApiContext(event, {
        mutation: true,
    });
    const webhookId = requireWebhookId(event);
    const existing = await requireAdminWebhook(store, webhookId);

    if (body.data.url && body.data.url !== existing.url) {
        await validateWebhookTargetUrl(body.data.url);
    }

    const nextCustomHooks =
        body.data.custom_hooks === undefined
            ? existing.custom_hooks
            : normalizeCustomHookNames(body.data.custom_hooks);
    const nextEvents = body.data.events ?? existing.events;

    if (nextEvents.length === 0 && nextCustomHooks.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'At least one event or custom hook is required',
        });
    }

    const patch: Parameters<typeof store.updateWebhook>[1] = {};
    if (body.data.url !== undefined) {
        patch.url = body.data.url;
    }
    if (body.data.label !== undefined) {
        patch.label = body.data.label;
    }
    if (body.data.events !== undefined) {
        patch.events = body.data.events;
    }
    if (body.data.custom_hooks !== undefined) {
        patch.custom_hooks = nextCustomHooks;
    }
    if (body.data.workspace_id !== undefined) {
        patch.workspace_id = body.data.workspace_id;
    }

    const updated = await store.updateWebhook(webhookId, patch);

    await refreshAdminWebhookListeners();

    return {
        webhook: serializeWebhook(updated),
    };
});
