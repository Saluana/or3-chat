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

export function getActiveStorageProvider(): ObjectStorageProvider | null {
    const config = useRuntimeConfig();
    const providerId = config.public?.storage?.provider || 'convex';
    const items = registry.snapshot();
    const entry = items.find((item) => item.id === providerId);
    return entry?.create() ?? null;
}

export function _resetStorageProviders(): void {
    registry.listIds().forEach((id) => registry.unregister(id));
}
