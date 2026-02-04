/**
 * @module app/core/workspace/composables.ts
 *
 * Purpose:
 * Composables for workspace API access. Provides Vue-friendly interface for
 * workspace operations in components.
 *
 * Usage:
 * ```vue
 * <script setup>
 * import { useWorkspaceApi } from '~/core/workspace/composables';
 *
 * const api = useWorkspaceApi();
 * const workspaces = await api.list();
 * </script>
 * ```
 */
import { getActiveWorkspaceApi } from './registry';
import type { WorkspaceApi } from './types';

/**
 * Purpose:
 * Returns the active workspace API instance.
 *
 * Behavior:
 * - Resolves to configured or default workspace API
 * - Throws error if no API available (should never happen if gateway is registered)
 *
 * @returns Active WorkspaceApi instance
 * @throws Error if no workspace API is registered
 *
 * @example
 * ```ts
 * const api = useWorkspaceApi();
 * const workspaces = await api.list();
 * await api.create({ name: 'My Workspace' });
 * ```
 */
export function useWorkspaceApi(): WorkspaceApi {
    const api = getActiveWorkspaceApi();
    if (!api) {
        throw new Error(
            '[workspace] No workspace API registered. Ensure gateway or provider API is installed.'
        );
    }
    return api;
}
