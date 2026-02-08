/**
 * @module server/auth/store/registry.ts
 *
 * Purpose:
 * Central registry for AuthWorkspaceStore implementations. Decouples session
 * provisioning from specific backend technologies (Convex, SQL, etc.).
 *
 * Responsibilities:
 * - Maintain a mapping of store IDs to their factory functions.
 * - Provide discovery mechanism for workspace/user persistence backends.
 *
 * Constraints:
 * - Stores are registered at module load time (usually in provider Nitro plugins).
 * - Instantiation is lazy to avoid unnecessary setup for unused stores.
 */
import type { AuthWorkspaceStore } from './types';

export type AuthWorkspaceStoreFactory = () => AuthWorkspaceStore;

export interface AuthWorkspaceStoreRegistryItem {
    id: string;
    order?: number;
    create: AuthWorkspaceStoreFactory;
}

const stores = new Map<string, AuthWorkspaceStoreRegistryItem>();

/**
 * Purpose:
 * Registers an AuthWorkspaceStore factory in the global registry.
 *
 * Behavior:
 * Stores the factory and metadata. In development mode, warns if an existing
 * store with the same ID is being replaced.
 *
 * @example
 * ```ts
 * registerAuthWorkspaceStore({
 *   id: 'convex',
 *   create: () => new ConvexAuthWorkspaceStore()
 * });
 * ```
 */
export function registerAuthWorkspaceStore(
    item: AuthWorkspaceStoreRegistryItem
): void {
    if (import.meta.dev && stores.has(item.id)) {
        console.warn(`[auth:store:registry] Replacing store: ${item.id}`);
    }
    stores.set(item.id, item);
}

/**
 * Purpose:
 * Retrieves and instantiates an AuthWorkspaceStore by its ID.
 *
 * Behavior:
 * Looks up the registry item and invokes the `create()` factory if found.
 *
 * @param id - The unique ID of the store (e.g., 'convex', 'sqlite').
 * @returns An initialized `AuthWorkspaceStore` instance, or `null` if not registered.
 *
 * @example
 * ```ts
 * const store = getAuthWorkspaceStore('convex');
 * if (store) {
 *   const { userId } = await store.getOrCreateUser({ ... });
 * }
 * ```
 */
export function getAuthWorkspaceStore(id: string): AuthWorkspaceStore | null {
    const item = stores.get(id);
    return item ? item.create() : null;
}

/**
 * Purpose:
 * Returns a list of all registered store IDs.
 * Primarily used for diagnostics or configuration validation.
 */
export function listAuthWorkspaceStoreIds(): string[] {
    return Array.from(stores.keys());
}
