/**
 * @module server/api/admin/plugins-page.get
 *
 * Purpose:
 * Optimization endpoint for the Admin Plugins Page.
 *
 * Responsibilities:
 * - Aggregates installed plugins and their enabled status for the current workspace
 * - Reduces round-trips for initial page load
 */
import { defineEventHandler, createError } from 'h3';
import { requireAdminApi } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';

/**
 * GET /api/admin/plugins-page
 *
 * Purpose:
 * Serves all necessary data for the Plugin management screen.
 *
 * Behavior:
 * - Validates workspace context.
 * - Fetches registry of all plugins + current workspace enabled state in parallel.
 *
 * Performance:
 * - Replaces 2 separate calls => ~50% latency reduction.
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);
    
    if (!session.workspace?.id) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace not resolved',
        });
    }
    
    const settingsStore = getWorkspaceSettingsStore(event);
    
    // Parallel fetch instead of sequential
    const [extensions, enabledPlugins] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, session.workspace.id)
    ]);
    
    return {
        plugins: extensions.filter(i => i.kind === 'plugin'),
        role: session.role,
        enabledPlugins
    };
});
