/**
 * @module server/storage/gateway/registry.ts
 *
 * Purpose:
 * Central registry for StorageGatewayAdapter implementations. Enables storage
 * backends to register their server-side adapters without tight coupling.
 *
 * Responsibilities:
 * - Maintain a mapping of adapter IDs to their factory functions.
 * - Provide discovery mechanism for storage backend adapters.
 * - Support active adapter resolution from runtime config.
 *
 * Constraints:
 * - Adapters are registered at module load time (usually in provider Nitro plugins).
 * - Instantiation is lazy to avoid unnecessary setup for unused adapters.
 */
import type { StorageGatewayAdapter } from './types';
import { useRuntimeConfig } from '#imports';

export type StorageGatewayAdapterFactory = () => StorageGatewayAdapter;

export interface StorageGatewayAdapterRegistryItem {
    id: string;
    order?: number;
    create: StorageGatewayAdapterFactory;
}

const adapters = new Map<string, StorageGatewayAdapterRegistryItem>();

/**
 * Purpose:
 * Registers a StorageGatewayAdapter factory in the global registry.
 *
 * Behavior:
 * Stores the factory and metadata. In development mode, warns if an existing
 * adapter with the same ID is being replaced.
 *
 * @example
 * ```ts
 * registerStorageGatewayAdapter({
 *   id: 'convex',
 *   create: () => new ConvexStorageGatewayAdapter()
 * });
 * ```
 */
export function registerStorageGatewayAdapter(
    item: StorageGatewayAdapterRegistryItem
): void {
    if (import.meta.dev && adapters.has(item.id)) {
        console.warn(
            `[storage:gateway:registry] Replacing adapter: ${item.id}`
        );
    }
    adapters.set(item.id, item);
}

/**
 * Purpose:
 * Retrieves and instantiates a StorageGatewayAdapter by its ID.
 *
 * Behavior:
 * Looks up the registry item and invokes the `create()` factory if found.
 *
 * @param id - The unique ID of the adapter (e.g., 'convex', 's3', 'localfs').
 * @returns An initialized `StorageGatewayAdapter` instance, or `null` if not registered.
 *
 * @example
 * ```ts
 * const adapter = getStorageGatewayAdapter('convex');
 * if (adapter) {
 *   const result = await adapter.presignUpload(event, { ... });
 * }
 * ```
 */
export function getStorageGatewayAdapter(
    id: string
): StorageGatewayAdapter | null {
    const item = adapters.get(id);
    return item ? item.create() : null;
}

/**
 * Purpose:
 * Returns the active storage gateway adapter based on runtime configuration.
 *
 * Behavior:
 * - Reads storage.provider from runtime config
 * - Returns the corresponding registered adapter
 * - Returns null if provider not configured or not registered
 *
 * @returns The active `StorageGatewayAdapter` instance, or `null`.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const adapter = getActiveStorageGatewayAdapter();
 *   if (!adapter) {
 *     throw createError({ statusCode: 500, statusMessage: 'Storage not configured' });
 *   }
 *   return await adapter.presignUpload(event, body);
 * });
 * ```
 */
export function getActiveStorageGatewayAdapter(): StorageGatewayAdapter | null {
    const config = useRuntimeConfig();
    const providerId = config.public.storage.provider;
    if (!providerId) return null;
    return getStorageGatewayAdapter(providerId);
}

/**
 * Purpose:
 * Returns a list of all registered adapter IDs.
 * Primarily used for diagnostics or configuration validation.
 */
export function listStorageGatewayAdapterIds(): string[] {
    return Array.from(adapters.keys());
}
