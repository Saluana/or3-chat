/**
 * @module app/core/workspace/registry.ts
 *
 * Purpose:
 * Central registry for WorkspaceApi implementations. Enables workspace UI to
 * resolve the active workspace API without importing provider-specific code.
 *
 * Responsibilities:
 * - Maintain a mapping of API IDs to their factory functions.
 * - Provide discovery mechanism for workspace API implementations.
 * - Support active API resolution from runtime config.
 *
 * Constraints:
 * - APIs are registered at plugin load time (usually in provider plugins).
 * - Instantiation is lazy to avoid unnecessary setup.
 */
import type { WorkspaceApi } from './types';

export type WorkspaceApiFactory = () => WorkspaceApi;

export interface WorkspaceApiRegistryItem {
    id: string;
    order?: number;
    create: WorkspaceApiFactory;
}

const apis = new Map<string, WorkspaceApiRegistryItem>();

/**
 * Purpose:
 * Registers a WorkspaceApi factory in the global registry.
 *
 * Behavior:
 * Stores the factory and metadata. In development mode, warns if an existing
 * API with the same ID is being replaced.
 *
 * @example
 * ```ts
 * registerWorkspaceApi({
 *   id: 'gateway',
 *   create: () => createGatewayWorkspaceApi()
 * });
 * ```
 */
export function registerWorkspaceApi(item: WorkspaceApiRegistryItem): void {
    if (import.meta.dev && apis.has(item.id)) {
        console.warn(`[workspace:registry] Replacing API: ${item.id}`);
    }
    apis.set(item.id, item);
}

/**
 * Purpose:
 * Retrieves and instantiates a WorkspaceApi by its ID.
 *
 * Behavior:
 * Looks up the registry item and invokes the `create()` factory if found.
 *
 * @param id - The unique ID of the API (e.g., 'gateway', 'convex-direct').
 * @returns An initialized `WorkspaceApi` instance, or `null` if not registered.
 *
 * @example
 * ```ts
 * const api = getWorkspaceApi('gateway');
 * if (api) {
 *   const workspaces = await api.list();
 * }
 * ```
 */
export function getWorkspaceApi(id: string): WorkspaceApi | null {
    const item = apis.get(id);
    return item ? item.create() : null;
}

/**
 * Purpose:
 * Returns the active workspace API based on runtime configuration or default.
 *
 * Behavior:
 * - Defaults to 'gateway' for maximum compatibility
 * - Falls back to first registered API if gateway not available
 * - Returns null if no APIs registered
 *
 * @returns The active `WorkspaceApi` instance, or `null`.
 */
export function getActiveWorkspaceApi(): WorkspaceApi | null {
    // Always prefer gateway mode for simplicity
    const gateway = getWorkspaceApi('gateway');
    if (gateway) return gateway;

    // Fallback to first registered API
    const firstId = Array.from(apis.keys())[0];
    return firstId ? getWorkspaceApi(firstId) : null;
}

/**
 * Purpose:
 * Returns a list of all registered API IDs.
 * Primarily used for diagnostics or configuration validation.
 */
export function listWorkspaceApiIds(): string[] {
    return Array.from(apis.keys());
}
