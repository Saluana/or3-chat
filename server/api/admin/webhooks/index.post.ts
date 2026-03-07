import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import {
    ADMIN_WEBHOOK_EVENT_TYPES,
} from '../../../../shared/webhooks/event-types';
import {
    encryptSecret,
    generateSigningSecret,
} from '../../../utils/webhooks/crypto';
import {
    getAdminWebhookRuntimeSettings,
    normalizeCustomHookNames,
    refreshAdminWebhookListeners,
    requireAdminWebhookApiContext,
    requireWebhookEncryptionKey,
    serializeWebhook,
    validateWebhookTargetUrl,
} from './_helpers';

const BodySchema = z
    .object({
        url: z.string().min(1),
        label: z.string().max(100).optional(),
        events: z.array(z.enum(ADMIN_WEBHOOK_EVENT_TYPES)).default([]),
        custom_hooks: z.array(z.string()).optional().default([]),
        workspace_id: z.string().min(1).nullable().optional(),
    })
    .refine(
        (value) => value.events.length > 0 || value.custom_hooks.length > 0,
        {
            message: 'At least one event or custom hook is required',
        }
    );

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
    const settings = getAdminWebhookRuntimeSettings();
    const existing = await store.listAdminWebhooks();

    if (existing.length >= settings.adminMax) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Admin webhook limit exceeded',
        });
    }

    await validateWebhookTargetUrl(body.data.url);
    const customHooks = normalizeCustomHookNames(body.data.custom_hooks);
    const signingSecret = generateSigningSecret();

    const created = await store.createWebhook({
        scope: 'admin',
        user_id: null,
        workspace_id: body.data.workspace_id ?? null,
        url: body.data.url,
        label: body.data.label?.trim() ?? '',
        events: body.data.events,
        custom_hooks: customHooks,
        signing_secret_enc: encryptSecret(
            signingSecret,
            requireWebhookEncryptionKey()
        ),
        enabled: true,
    });

    await refreshAdminWebhookListeners();

    return {
        webhook: serializeWebhook(created),
        signing_secret: signingSecret,
    };
});
