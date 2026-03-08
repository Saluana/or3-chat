import { useRuntimeConfig } from '#imports';
import type { WebhookStore } from './types';

export interface WebhookStoreRegistryItem {
    id: string;
    order?: number;
    create: () => WebhookStore;
}

const stores = new Map<string, WebhookStoreRegistryItem>();
const storeInstances = new Map<string, WebhookStore>();

export function registerWebhookStore(item: WebhookStoreRegistryItem): void {
    if (import.meta.dev && stores.has(item.id)) {
        console.warn(`[webhooks:store:registry] Replacing store: ${item.id}`);
    }

    stores.set(item.id, item);
    storeInstances.delete(item.id);
}

export function getWebhookStore(id: string): WebhookStore | null {
    const cached = storeInstances.get(id);
    if (cached) {
        return cached;
    }

    const item = stores.get(id);
    if (!item) {
        return null;
    }

    const instance = item.create();
    storeInstances.set(id, instance);
    return instance;
}

export function getActiveWebhookStore(): WebhookStore | null {
    const config = useRuntimeConfig();
    const providerId = config.sync.provider || config.public.sync.provider;
    if (!providerId) {
        return null;
    }

    return getWebhookStore(providerId);
}

export function listWebhookStoreIds(): string[] {
    return Array.from(stores.keys());
}
