/**
 * @module app/core/storage/provider-registry
 *
 * Purpose:
 * Registry for object storage provider implementations. Manages provider
 * registration, selection, and instantiation. The active provider is
 * determined by runtime config (`public.storage.provider`) and defaults
 * to the Convex storage provider.
 *
 * Responsibilities:
 * - Register/unregister `ObjectStorageProvider` factories
 * - Resolve the active provider based on runtime config
 * - Cache provider instances to avoid repeated factory calls
 *
 * Constraints:
 * - Uses `useRuntimeConfig()` at resolution time (must be called in Nuxt context)
 * - Provider instance is memoized per provider ID; changing config requires reset
 *
 * @see core/storage/types for ObjectStorageProvider interface
 * @see core/storage/providers/ for concrete implementations
 */
import { createRegistry } from '~/composables/_registry';
import { useRuntimeConfig } from '#imports';
import type { ObjectStorageProvider } from './types';
import { CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

/**
 * Purpose:
 * Registry entry describing a storage provider factory.
 *
 * Constraints:
 * - `id` must be unique across all registered providers
 * - `create()` must be side-effect free and fast; instances are memoized
 */
export interface StorageProviderRegistryItem {
    id: string;
    order?: number;
    create: () => ObjectStorageProvider;
}

const registry = createRegistry<StorageProviderRegistryItem>(
    '__or3_storage_providers'
);

/** Register a storage provider factory. */
export const registerStorageProvider = registry.register;
/** Unregister a storage provider factory by ID. */
export const unregisterStorageProvider = registry.unregister;
/** List registered provider IDs. */
export const listStorageProviderIds = registry.listIds;
/** Vue composable that exposes registered provider items. */
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

/**
 * Purpose:
 * Resolve (and memoize) the active object storage provider.
 *
 * Behavior:
 * Selects provider by `public.storage.provider` runtime config, falling back
 * to `CONVEX_STORAGE_PROVIDER_ID`.
 *
 * Constraints:
 * - Must run in a Nuxt runtime config context
 * - Memoized per provider ID; call `_resetStorageProviders()` in tests
 */
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

/**
 * Internal API.
 *
 * Purpose:
 * Reset provider registry and memoized instance. Intended for tests.
 */
export function _resetStorageProviders(): void {
    cachedProvider = null;
    cachedProviderId = null;
    registry.listIds().forEach((id) => registry.unregister(id));
}
