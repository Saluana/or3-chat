import { defineEventHandler, createError } from 'h3';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { createLimitedWebhook } from '../../utils/webhooks/registration';
import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from '../../../shared/webhooks/event-types';
import { encryptSecret, generateSigningSecret } from '../../utils/webhooks/crypto';
import {
    getWebhookRuntimeSettings,
    requireWebhookApiContext,
    requireWebhookEncryptionKey,
    serializeWebhook,
    validateWebhookTargetUrl,
} from './_helpers';

const BodySchema = z.object({
    url: z.string().min(1),
    label: z.string().max(100).optional(),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
});

export default defineEventHandler(async (event) => {
    const { store, userId, workspaceId } = await requireWebhookApiContext(event);
    const body = BodySchema.safeParse(await readLimitedJsonBody(event));
    if (!body.success) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid request',
        });
    }

    const settings = getWebhookRuntimeSettings();

    await validateWebhookTargetUrl(body.data.url);

    const signingSecret = generateSigningSecret();
    const created = await createLimitedWebhook(store, {
        scope: 'user',
        user_id: userId,
        workspace_id: workspaceId,
        url: body.data.url,
        label: body.data.label?.trim() ?? '',
        events: body.data.events,
        custom_hooks: [],
        signing_secret_enc: encryptSecret(
            signingSecret,
            requireWebhookEncryptionKey()
        ),
        enabled: true,
    }, settings.maxPerUser);

    return {
        webhook: serializeWebhook(created),
        signing_secret: signingSecret,
    };
});
