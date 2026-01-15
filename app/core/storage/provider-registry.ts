import { createRegistry } from '~/composables/_registry';
import { useRuntimeConfig } from '#imports';
import type { ObjectStorageProvider } from './types';

export interface StorageProviderRegistryItem {
    id: string;
    order?: number;
    create: () => ObjectStorageProvider;
}

const registry = createRegistry<StorageProviderRegistryItem>(
    '__or3_storage_providers'
);

export const registerStorageProvider = registry.register;
export const unregisterStorageProvider = registry.unregister;
export const listStorageProviderIds = registry.listIds;
export const useStorageProviders = registry.useItems;

// Memoize provider instance to avoid repeated factory calls
let cachedProvider: ObjectStorageProvider | null = null;
let cachedProviderId: string | null = null;

export function getActiveStorageProvider(): ObjectStorageProvider | null {
    const config = useRuntimeConfig();
    const providerId = config.public?.storage?.provider || 'convex';

    // Return cached instance if provider hasn't changed
    if (cachedProvider && cachedProviderId === providerId) {
        return cachedProvider;
    }

    const items = registry.snapshot();
    const entry = items.find((item) => item.id === providerId);
    cachedProvider = entry?.create() ?? null;
    cachedProviderId = providerId;
    return cachedProvider;
}

export function _resetStorageProviders(): void {
    cachedProvider = null;
    cachedProviderId = null;
    registry.listIds().forEach((id) => registry.unregister(id));
}
