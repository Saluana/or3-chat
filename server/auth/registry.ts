/**
 * Auth provider registry.
 * Manages registration and retrieval of auth providers.
 */
import type { AuthProvider, AuthProviderRegistryItem } from './types';

const providers = new Map<string, AuthProviderRegistryItem>();

/**
 * Register an auth provider factory.
 * @param item - Provider registry item with id and factory function
 */
export function registerAuthProvider(item: AuthProviderRegistryItem): void {
    if (import.meta.dev && providers.has(item.id)) {
        console.warn(`[auth:registry] Replacing provider: ${item.id}`);
    }
    providers.set(item.id, item);
}

/**
 * Get an auth provider by id.
 * @param id - Provider id (e.g., 'clerk')
 * @returns AuthProvider instance or null if not found
 */
export function getAuthProvider(id: string): AuthProvider | null {
    const item = providers.get(id);
    return item ? item.create() : null;
}

/**
 * List all registered provider ids.
 */
export function listProviderIds(): string[] {
    return Array.from(providers.keys());
}
