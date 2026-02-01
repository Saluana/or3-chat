import { createRegistry } from '~/composables/_registry';
import { useRuntimeConfig } from '#imports';
import type { ObjectStorageProvider } from './types';
import { CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

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

function getConfiguredProviderId(): string {
    const config = useRuntimeConfig();
    return config.public.storage.provider || CONVEX_STORAGE_PROVIDER_ID;
}

function createProviderFromConfig(): ObjectStorageProvider | null {
    const providerId = getConfiguredProviderId();
    const items = registry.snapshot();
    const entry = items.find((item) => item.id === providerId);
    return entry?.create() ?? null;
}

export function getActiveStorageProvider(): ObjectStorageProvider | null {
    const providerId = getConfiguredProviderId();

    // Return cached instance if provider hasn't changed
    if (cachedProvider && cachedProviderId === providerId) {
        return cachedProvider;
    }

    cachedProvider = createProviderFromConfig();
    cachedProviderId = providerId;
    return cachedProvider;
}

export function _resetStorageProviders(): void {
    cachedProvider = null;
    cachedProviderId = null;
    registry.listIds().forEach((id) => registry.unregister(id));
}
