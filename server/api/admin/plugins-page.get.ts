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
import { ImmutablePluginPackageStore } from '../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../admin/plugins/package-pointer-store';

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
    const canManageSitePlugins = isSuperAdmin(context);
    
    // Parallel fetch instead of sequential
    const [extensions, enabledPlugins] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId)
    ]);
    const packagePlugins = canManageSitePlugins
        ? await (async () => {
              const packages = new ImmutablePluginPackageStore();
              const pointers = new PluginPackagePointerStore(undefined, packages);
              const pluginIds = await pointers.listPluginIds();
              return await Promise.all(pluginIds.map(async (pluginId) => {
                  const [pointer, startup] = await Promise.all([
                      pointers.readPointer(pluginId).catch(() => null),
                      pointers.readStartupSelection(pluginId).catch(() => null),
                  ]);
                  return {
                      pluginId,
                      pointer,
                      workspaceEnabled: enabledPlugins.includes(pluginId),
                      startup: {
                          status: startup?.status ?? 'blocked',
                          selectedSlot: startup?.selectedSlot ?? null,
                          selectedDigest: startup?.selected?.packageDigest ?? null,
                          issueCodes: startup?.issues.map((issue) => issue.code) ?? [
                              'pointer-unavailable',
                          ],
                      },
                  };
              }));
          })()
        : [];
    
    return {
        plugins: extensions.filter(i => i.kind === 'plugin'),
        role: isSuperAdmin(context) ? 'owner' : context.session?.role,
        canManageSitePlugins,
        workspaceId,
        workspaceName:
            context.session?.workspace?.id === workspaceId
                ? context.session.workspace.name
                : undefined,
        enabledPlugins,
        packagePlugins,
    };
});
