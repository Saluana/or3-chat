/**
 * SyncProvider Registry
 *
 * Manages available sync providers and selects the active one.
 * Supports both direct (client-to-backend) and gateway (client-to-SSR) modes.
 */
import type { SyncProvider } from '~~/shared/sync/types';

/** Registry of available providers */
const providers = new Map<string, SyncProvider>();

/** Currently active provider ID */
let activeProviderId: string | null = null;

/**
 * Register a sync provider
 */
export function registerSyncProvider(provider: SyncProvider): void {
    if (providers.has(provider.id)) {
        console.warn(`[SyncProviderRegistry] Overwriting provider: ${provider.id}`);
    }
    providers.set(provider.id, provider);
}

/**
 * Unregister a sync provider
 */
export function unregisterSyncProvider(providerId: string): void {
    providers.delete(providerId);
    if (activeProviderId === providerId) {
        activeProviderId = null;
    }
}

/**
 * Set the active provider
 */
export function setActiveSyncProvider(providerId: string): void {
    if (!providers.has(providerId)) {
        throw new Error(`[SyncProviderRegistry] Unknown provider: ${providerId}`);
    }
    activeProviderId = providerId;
}

/**
 * Get the active sync provider
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
 * Get a provider by ID
 */
export function getSyncProvider(providerId: string): SyncProvider | null {
    return providers.get(providerId) ?? null;
}

/**
 * Get all registered providers
 */
export function getAllSyncProviders(): SyncProvider[] {
    return Array.from(providers.values());
}

/**
 * Clear all providers (for testing)
 */
export function _clearProviders(): void {
    providers.clear();
    activeProviderId = null;
}
