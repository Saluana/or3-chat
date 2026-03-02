import { createSqliteWebhookStore } from './sqlite-store';
import {
    getActiveWebhookStore,
    getWebhookStore,
    listWebhookStoreIds,
    registerWebhookStore,
} from './registry';
import type { WebhookStore } from './types';

type RuntimeConfigLike = {
    sync?: { provider?: unknown };
    public?: { sync?: { provider?: unknown } };
};

export function resolveWebhookStoreProviderId(
    config: RuntimeConfigLike
): string | null {
    const providerId =
        (config.sync as { provider?: unknown } | undefined)?.provider ??
        (config.public as { sync?: { provider?: unknown } } | undefined)?.sync
            ?.provider;

    return typeof providerId === 'string' && providerId.trim().length > 0
        ? providerId
        : null;
}

export function resolveConfiguredWebhookStore(
    config: RuntimeConfigLike
): WebhookStore | null {
    let store = getActiveWebhookStore();
    if (store) {
        return store;
    }

    const providerId = resolveWebhookStoreProviderId(config);
    if (!providerId) {
        return null;
    }

    if (providerId === 'sqlite' && !listWebhookStoreIds().includes('sqlite')) {
        registerWebhookStore({
            id: 'sqlite',
            create: createSqliteWebhookStore,
        });
    }

    store = getWebhookStore(providerId);
    return store;
}
