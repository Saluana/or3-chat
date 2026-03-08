import {
    getActiveWebhookStore,
    getWebhookStore,
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

    store = getWebhookStore(providerId);
    return store;
}
