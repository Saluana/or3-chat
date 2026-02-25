/**
 * @module server/sync/gateway/registry.ts
 *
 * Purpose:
 * Central registry for SyncGatewayAdapter implementations. Enables sync
 * backends to register their server-side adapters without tight coupling.
 *
 * Responsibilities:
 * - Maintain a mapping of adapter IDs to their factory functions.
 * - Provide discovery mechanism for sync backend adapters.
 * - Support active adapter resolution from runtime config.
 * - Cache adapter instances to avoid re-instantiation per request.
 *
 * Constraints:
 * - Adapters are registered at module load time (usually in provider Nitro plugins).
 * - Instantiation is lazy to avoid unnecessary setup for unused adapters.
 * - Instances are cached per adapter ID for performance.
 */
import type { SyncGatewayAdapter } from './types';
import { useRuntimeConfig } from '#imports';

export type SyncGatewayAdapterFactory = () => SyncGatewayAdapter;

export interface SyncGatewayAdapterRegistryItem {
    id: string;
    order?: number;
    create: SyncGatewayAdapterFactory;
}

const adapters = new Map<string, SyncGatewayAdapterRegistryItem>();
const adapterInstances = new Map<string, SyncGatewayAdapter>();

/**
 * Purpose:
 * Registers a SyncGatewayAdapter factory in the global registry.
 *
 * Behavior:
 * Stores the factory and metadata. In development mode, warns if an existing
 * adapter with the same ID is being replaced. Clears any cached instance.
 *
 * @example
 * ```ts
 * registerSyncGatewayAdapter({
 *   id: 'convex',
 *   create: () => new ConvexSyncGatewayAdapter()
 * });
 * ```
 */
export function registerSyncGatewayAdapter(
    item: SyncGatewayAdapterRegistryItem
): void {
    if (import.meta.dev && adapters.has(item.id)) {
        console.warn(
            `[sync:gateway:registry] Replacing adapter: ${item.id}`
        );
    }
    adapters.set(item.id, item);
    // Clear cached instance when re-registering
    adapterInstances.delete(item.id);
}

/**
 * Purpose:
 * Retrieves a SyncGatewayAdapter by its ID, using cached instances.
 *
 * Behavior:
 * Looks up the registry item. Returns cached instance if available,
 * otherwise invokes the `create()` factory and caches the result.
 *
 * @param id - The unique ID of the adapter (e.g., 'convex', 'sqlite').
 * @returns An initialized `SyncGatewayAdapter` instance, or `null` if not registered.
 *
 * @example
 * ```ts
 * const adapter = getSyncGatewayAdapter('convex');
 * if (adapter) {
 *   const result = await adapter.pull(event, { ... });
 * }
 * ```
 */
export function getSyncGatewayAdapter(
    id: string
): SyncGatewayAdapter | null {
    // Return cached instance if available
    const cached = adapterInstances.get(id);
    if (cached) {
        return cached;
    }

    // Create and cache new instance
    const item = adapters.get(id);
    if (!item) {
        return null;
    }

    const instance = item.create();
    adapterInstances.set(id, instance);
    return instance;
}

/**
 * Purpose:
 * Returns the active sync gateway adapter based on runtime configuration.
 *
 * Behavior:
 * - Reads sync.provider from runtime config
 * - Returns the corresponding registered adapter
 * - Returns null if provider not configured or not registered
 *
 * @returns The active `SyncGatewayAdapter` instance, or `null`.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const adapter = getActiveSyncGatewayAdapter();
 *   if (!adapter) {
 *     throw createError({ statusCode: 500, statusMessage: 'Sync not configured' });
 *   }
 *   return await adapter.pull(event, body);
 * });
 * ```
 */
export function getActiveSyncGatewayAdapter(): SyncGatewayAdapter | null {
    const config = useRuntimeConfig();
    const providerId = config.public.sync.provider;
    if (!providerId) return null;
    return getSyncGatewayAdapter(providerId);
}

/**
 * Purpose:
 * Returns a list of all registered adapter IDs.
 * Primarily used for diagnostics or configuration validation.
 */
export function listSyncGatewayAdapterIds(): string[] {
    return Array.from(adapters.keys());
}
