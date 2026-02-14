/**
 * @module app/core/sync/sync-provider-registry
 *
 * Purpose:
 * Registry for sync provider implementations. Maintains a map of available
 * providers and tracks which one is currently active. Supports both direct
 * (client-to-backend) and gateway (client-to-SSR) provider modes.
 *
 * Behavior:
 * - Providers are registered by plugins at startup
 * - Active provider can be set explicitly or defaults to the first registered
 * - Registry is global (module-level state)
 *
 * Constraints:
 * - Only one active provider at a time
 * - Overwriting a provider ID logs a warning in development
 * - Setting an unknown provider ID throws an error
 *
 * @see shared/sync/types for SyncProvider interface
 * @see core/sync/providers/ for concrete implementations
 */
import type { SyncProvider } from '~~/shared/sync/types';

/** Registry of available providers */
const providers = new Map<string, SyncProvider>();

/** Currently active provider ID */
let activeProviderId: string | null = null;

/**
 * Purpose:
 * Register a SyncProvider implementation.
 *
 * Behavior:
 * - Adds the provider to the registry keyed by `provider.id`
 * - Logs a warning in dev if a provider with the same id already exists
 *
 * Constraints:
 * - Does not automatically activate the provider
 */
export function registerSyncProvider(provider: SyncProvider): void {
    if (providers.has(provider.id)) {
        console.warn(`[SyncProviderRegistry] Overwriting provider: ${provider.id}`);
    }
    providers.set(provider.id, provider);
}

/**
 * Purpose:
 * Remove a SyncProvider from the registry.
 *
 * Behavior:
 * - If the removed provider was active, clears the active provider id
 */
export function unregisterSyncProvider(providerId: string): void {
    providers.delete(providerId);
    if (activeProviderId === providerId) {
        activeProviderId = null;
    }
}

/**
 * Purpose:
 * Set the active SyncProvider by id.
 *
 * Constraints:
 * - Throws if `providerId` is not registered
 */
export function setActiveSyncProvider(providerId: string): void {
    if (!providers.has(providerId)) {
        throw new Error(`[SyncProviderRegistry] Unknown provider: ${providerId}`);
    }
    activeProviderId = providerId;
}

/**
 * Purpose:
 * Return the active SyncProvider.
 *
 * Behavior:
 * - If no active provider is set, returns the first registered provider
 */
export function getActiveSyncProvider(): SyncProvider | null {
    if (!activeProviderId) {
        // Default to first registered provider
        const first = providers.values().next().value;
        return first ?? null;
    }
    return providers.get(activeProviderId) ?? null;
}

/**
 * Purpose:
 * Look up a registered SyncProvider by id.
 */
export function getSyncProvider(providerId: string): SyncProvider | null {
    return providers.get(providerId) ?? null;
}

/**
 * Purpose:
 * Return all registered SyncProviders.
 *
 * Constraints:
 * - Ordering matches insertion order
 */
export function getAllSyncProviders(): SyncProvider[] {
    return Array.from(providers.values());
}

/**
 * Internal API.
 *
 * Purpose:
 * Clear the provider registry. Intended for tests.
 */
export function _clearProviders(): void {
    providers.clear();
    activeProviderId = null;
}
