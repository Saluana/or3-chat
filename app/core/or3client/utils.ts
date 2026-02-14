/**
 * OR3 Client Utility Types and Functions
 *
 * Provides adapter interfaces and SSR guard utilities for the unified registry system.
 */

import { computed, type ComputedRef } from 'vue';

/**
 * Standard interface for registry adapters.
 * All methods delegate to existing composables—no new logic here.
 *
 * @template T - The registry item type, must have an `id` field
 */
export interface RegistryAdapter<T extends { id: string }> {
    /** Register a new item. Delegates to existing composable. */
    register(item: T): void;

    /** Unregister by ID. Delegates to existing composable. */
    unregister(id: string): void;

    /** Get a single item by ID. Returns undefined if not found. */
    get(id: string): T | undefined;

    /** Non‑reactive snapshot of all items. */
    list(): Readonly<T[]>;

    /** Reactive list for use in Vue components. */
    useItems(): ComputedRef<readonly T[]>;

    /** List of all registered IDs. */
    listIds(): string[];
}

/**
 * Standard interface for service adapters.
 * Returns the underlying service/composable instance.
 *
 * @template T - The service type
 */
export interface ServiceAdapter<T> {
    /** Returns the service instance (calls underlying composable). */
    use(): T;
}

/**
 * Creates a no-op registry adapter for SSR.
 * Returns an empty adapter that does nothing on server-side.
 */
function createNoOpAdapter<T extends { id: string }>(): RegistryAdapter<T> {
    return {
        register: () => {},
        unregister: () => {},
        get: () => undefined,
        list: () => [],
        useItems: () => computed(() => []),
        listIds: () => [],
    };
}

/**
 * Wraps a registry adapter factory to return no-op on server.
 * Use this for client-only registries (sidebar pages, tools, etc).
 *
 * @example
 * export const sidebarPagesAdapter = clientOnlyAdapter(() => {
 *   const api = useSidebarPages();
 *   return { ... };
 * });
 */
export function clientOnlyAdapter<T extends { id: string }>(
    factory: () => RegistryAdapter<T>
): RegistryAdapter<T> {
    // Server: return no-op adapter
    if (import.meta.server) {
        return createNoOpAdapter<T>();
    }
    // Client: call factory and return real adapter
    return factory();
}

/**
 * Wraps a service adapter factory to return a no-op on server.
 * Use this for client-only services.
 *
 * @example
 * export const toolsAdapter = clientOnlyServiceAdapter(() => {
 *   return { use: () => useToolRegistry() };
 * }, () => ({ tools: new Map(), ... }));
 */
export function clientOnlyServiceAdapter<T>(
    factory: () => ServiceAdapter<T>,
    fallback: () => T
): ServiceAdapter<T> {
    if (import.meta.server) {
        return { use: fallback };
    }
    return factory();
}
