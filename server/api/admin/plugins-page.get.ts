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
import { defineEventHandler, getQuery } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { isSuperAdmin } from '../../admin/context';

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
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        allowWorkspaceAdmin: true,
    });
    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        getQuery(event).workspaceId
    );
    
    const settingsStore = getWorkspaceSettingsStore(event);
    
    // Parallel fetch instead of sequential
    const [extensions, enabledPlugins] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId)
    ]);
    
    return {
        plugins: extensions.filter(i => i.kind === 'plugin'),
        role: isSuperAdmin(context) ? 'owner' : context.session?.role,
        workspaceId,
        workspaceName:
            context.session?.workspace?.id === workspaceId
                ? context.session.workspace.name
                : undefined,
        enabledPlugins,
    };
});
