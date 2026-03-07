import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireAdminApiContext } from '../../../admin/api';
import {
    refreshActiveWebhookCustomHookListeners,
} from '../../../utils/webhooks/runtime';
import {
    resolveConfiguredWebhookStore,
} from '../../../utils/webhooks/store/resolve-store';
import type {
    WebhookRegistration,
    WebhookStore,
} from '../../../utils/webhooks/store/types';
import {
    createWebhookRouteDispatcher,
    requireWebhookEncryptionKey,
    requireWebhookId,
    requireWebhookSigningSecret,
    resolveWebhookLogSince,
    serializeWebhook,
    validateWebhookTargetUrl,
} from '../../webhooks/_helpers';

const CUSTOM_HOOK_PATTERN = /:(action|filter):/;

export interface AdminWebhookRuntimeSettings {
    adminMax: number;
}

export async function requireAdminWebhookApiContext(
    event: H3Event,
    options: { mutation?: boolean } = {}
): Promise<{ store: WebhookStore }> {
    const config = useRuntimeConfig();
    if (!config.webhooks.enabled) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    await requireAdminApiContext(event, {
        superAdminOnly: true,
        mutation: options.mutation,
    });

    const store = resolveConfiguredWebhookStore(config);
    if (!store) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Webhook store not configured',
        });
    }

    return { store };
}

export function getAdminWebhookRuntimeSettings(): AdminWebhookRuntimeSettings {
    const config = useRuntimeConfig();

    return {
        adminMax: Number(config.webhooks.adminMax),
    };
}

export async function requireAdminWebhook(
    store: WebhookStore,
    webhookId: string
): Promise<WebhookRegistration> {
    const webhook = await store.getWebhook(webhookId);
    if (!webhook || webhook.scope !== 'admin') {
        throw createError({
            statusCode: 404,
            statusMessage: 'Webhook not found',
        });
    }

    return webhook;
}

export function normalizeCustomHookNames(input: unknown): string[] {
    if (!Array.isArray(input)) {
        return [];
    }

    const normalized = new Set<string>();
    for (const value of input) {
        if (typeof value !== 'string') {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid custom hook name',
            });
        }

        const hookName = value.trim();
        if (!hookName || !CUSTOM_HOOK_PATTERN.test(hookName)) {
            throw createError({
                statusCode: 400,
                statusMessage:
                    'Custom hook names must be non-empty and include :action: or :filter:',
            });
        }

        normalized.add(hookName);
    }

    return Array.from(normalized);
}

export async function refreshAdminWebhookListeners(): Promise<void> {
    await refreshActiveWebhookCustomHookListeners();
}

export {
    createWebhookRouteDispatcher,
    requireWebhookEncryptionKey,
    requireWebhookId,
    requireWebhookSigningSecret,
    resolveWebhookLogSince,
    serializeWebhook,
    validateWebhookTargetUrl,
};
