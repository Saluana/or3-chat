import type { H3Event } from 'h3';
import { createError, getRouterParam } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../auth/can';
import { resolveSessionContext } from '../../auth/session';
import { decryptSecret } from '../../utils/webhooks/crypto';
import {
    createWebhookDispatcher,
    type WebhookDispatcher,
} from '../../utils/webhooks/dispatcher';
import {
    resolveConfiguredWebhookStore,
} from '../../utils/webhooks/store/resolve-store';
import type { WebhookRegistration, WebhookStore } from '../../utils/webhooks/store/types';
import { validateWebhookUrl } from '../../utils/webhooks/url-validator';

export type UserWebhookResponse = Omit<WebhookRegistration, 'signing_secret_enc'>;

export interface WebhookApiContext {
    userId: string;
    workspaceId: string;
    store: WebhookStore;
}

export interface WebhookRuntimeSettings {
    forceHttps: boolean;
    maxPerUser: number;
    rateLimitPerMinute: number;
    deliveryTimeoutMs: number;
    blockPrivateIps: boolean;
    maxRetryHours: number;
    logRetentionHours: number;
}

export function serializeWebhook(
    webhook: WebhookRegistration
): UserWebhookResponse {
    const { signing_secret_enc: _signingSecret, ...rest } = webhook;
    return rest;
}

function resolveWebhookStore(): WebhookStore {
    const config = useRuntimeConfig();
    const store = resolveConfiguredWebhookStore(config);

    if (!store) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Webhook store not configured',
        });
    }

    return store;
}

export async function requireWebhookApiContext(
    event: H3Event
): Promise<WebhookApiContext> {
    const config = useRuntimeConfig();
    if (!config.auth.enabled || !config.webhooks.enabled) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const session = await resolveSessionContext(event);
    requireSession(session);

    const userId = session.user?.id;
    const workspaceId = session.workspace?.id;
    if (!userId || !workspaceId) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Unauthorized',
        });
    }

    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: workspaceId,
    });

    return {
        userId,
        workspaceId,
        store: resolveWebhookStore(),
    };
}

export function requireWebhookEncryptionKey(): string {
    const config = useRuntimeConfig();
    const encryptionKey: unknown = config.webhooks.encryptionKey;

    if (typeof encryptionKey === 'string' && encryptionKey.trim()) {
        return encryptionKey;
    }

    console.warn(
        '[webhooks] Refusing webhook mutation because no webhook encryption key is configured'
    );
    throw createError({
        statusCode: 503,
        statusMessage: 'Webhook secret storage is not configured',
    });
}

export function requireWebhookSigningSecret(
    webhook: WebhookRegistration
): string {
    return decryptSecret(
        webhook.signing_secret_enc,
        requireWebhookEncryptionKey()
    );
}

export function getWebhookRuntimeSettings(): WebhookRuntimeSettings {
    const config = useRuntimeConfig();

    return {
        forceHttps: Boolean(config.security.forceHttps),
        maxPerUser: Number(config.webhooks.maxPerUser),
        rateLimitPerMinute: Number(config.webhooks.rateLimitPerMinute),
        deliveryTimeoutMs: Number(config.webhooks.deliveryTimeoutMs),
        blockPrivateIps: config.webhooks.blockPrivateIps !== false,
        maxRetryHours: Number(config.webhooks.maxRetryHours),
        logRetentionHours: Number(config.webhooks.logRetentionHours),
    };
}

export async function validateWebhookTargetUrl(rawUrl: string): Promise<URL> {
    const settings = getWebhookRuntimeSettings();

    try {
        return await validateWebhookUrl(rawUrl, {
            requireHttps: settings.forceHttps,
            blockPrivateIps: settings.blockPrivateIps,
        });
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage:
                error instanceof Error ? error.message : 'Invalid webhook URL',
        });
    }
}

export function createWebhookRouteDispatcher(
    store: WebhookStore
): WebhookDispatcher {
    const settings = getWebhookRuntimeSettings();

    return createWebhookDispatcher(store, {
        rateLimitPerMinute: settings.rateLimitPerMinute,
        deliveryTimeoutMs: settings.deliveryTimeoutMs,
        blockPrivateIps: settings.blockPrivateIps,
        requireHttps: settings.forceHttps,
        encryptionKey: requireWebhookEncryptionKey(),
        maxRetryHours: settings.maxRetryHours,
    });
}

export function resolveWebhookLogSince(rawSince: unknown): number {
    if (rawSince === undefined) {
        return (
            Date.now() -
            getWebhookRuntimeSettings().logRetentionHours * 60 * 60 * 1000
        );
    }

    const sinceValue: unknown = Array.isArray(rawSince)
        ? rawSince.at(0)
        : rawSince;
    const since = Number(sinceValue);

    if (!Number.isFinite(since) || since < 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid since query parameter',
        });
    }

    return Math.floor(since);
}

export async function requireOwnedWebhook(
    store: WebhookStore,
    webhookId: string,
    userId: string,
    workspaceId: string
): Promise<WebhookRegistration> {
    const webhook = await store.getWebhook(webhookId);
    if (!webhook) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Webhook not found',
        });
    }

    if (
        webhook.scope !== 'user' ||
        webhook.user_id !== userId ||
        webhook.workspace_id !== workspaceId
    ) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden',
        });
    }

    return webhook;
}

export function requireWebhookId(event: H3Event): string {
    const webhookId = getRouterParam(event, 'id');
    if (!webhookId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Webhook id is required',
        });
    }

    return webhookId;
}
