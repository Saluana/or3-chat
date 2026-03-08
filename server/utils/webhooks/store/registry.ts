import type { WebhookStore } from './types';
import { createRuntimeConfigRegistry } from '../../registry/create-runtime-config-registry';

export interface WebhookStoreRegistryItem {
    id: string;
    order?: number;
    create: () => WebhookStore;
}

const registry = createRuntimeConfigRegistry<WebhookStore, WebhookStoreRegistryItem>({
    warnLabel: 'webhooks:store:registry',
    cacheInstances: true,
    resolveActiveId(config) {
        return config.sync.provider || config.public.sync.provider;
    },
});

export function registerWebhookStore(item: WebhookStoreRegistryItem): void {
    registry.register(item);
}

export function getWebhookStore(id: string): WebhookStore | null {
    return registry.get(id);
}

export function getActiveWebhookStore(): WebhookStore | null {
    return registry.getActive();
}

export function listWebhookStoreIds(): string[] {
    return registry.listIds();
}
