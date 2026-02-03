/**
 * @module server/auth/registry.ts
 *
 * Purpose:
 * Central registry for SSR Auth Providers. Decouples the session resolution
 * logic from specific provider implementations, allowing for lazy instantiation
 * and dynamic configuration.
 *
 * Responsibilities:
 * - Maintain a mapping of provider IDs to their factory functions.
 * - Provide a consistent discovery mechanism for auth modules.
 *
 * Constraints:
 * - Providers are registered at module load time (usually in provider `index.ts` files).
 * - Instantiation is lazy to avoid unnecessary setup for unused providers.
 */
import type { AuthProvider, AuthProviderRegistryItem } from './types';

const providers = new Map<string, AuthProviderRegistryItem>();

/**
 * Purpose:
 * Registers an auth provider factory in the global registry.
 *
 * Behavior:
 * Stores the factory and metadata. In development mode, warns if an existing
 * provider with the same ID is being replaced.
 *
 * Constraints:
 * - Should be called early in the application lifecycle.
 */
export function registerAuthProvider(item: AuthProviderRegistryItem): void {
    if (import.meta.dev && providers.has(item.id)) {
        console.warn(`[auth:registry] Replacing provider: ${item.id}`);
    }
    providers.set(item.id, item);
}

/**
 * Purpose:
 * Retrieves and instantiates an auth provider by its ID.
 *
 * Behavior:
 * Looks up the registry item and invokes the `create()` factory if found.
 *
 * @param id - The unique ID of the provider (e.g., 'clerk').
 * @returns An initialized `AuthProvider` instance, or `null` if not registered.
 */
export function getAuthProvider(id: string): AuthProvider | null {
    const item = providers.get(id);
    return item ? item.create() : null;
}

/**
 * Purpose:
 * Returns a list of all registered provider IDs.
 * Primarily used for diagnostics or configuration validation.
 */
export function listProviderIds(): string[] {
    return Array.from(providers.keys());
}
