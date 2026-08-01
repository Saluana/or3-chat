import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { getEnabledPlugins } from '../../../../../admin/plugins/workspace-plugin-store';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';

/** Read-only operator status. It deliberately returns identities and lifecycle
 * slots, never package files, settings, grants, or canary state snapshots. */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        superAdminOnly: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    if (!pluginId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing plugin id' });
    }
    const query = getQuery(event);
    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        typeof query.workspaceId === 'string' ? query.workspaceId : undefined
    );
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const [pointer, selection, enabled] = await Promise.all([
        pointers.readPointer(pluginId),
        pointers.readStartupSelection(pluginId),
        getEnabledPlugins(getWorkspaceSettingsStore(event), workspaceId),
    ]);
    return {
        pluginId,
        workspaceId,
        workspaceEnabled: enabled.includes(pluginId),
        pointer,
        startup: {
            status: selection.status,
            selectedSlot: selection.selectedSlot,
            selectedDigest: selection.selected?.packageDigest ?? null,
            issueCodes: selection.issues.map((issue) => issue.code),
        },
    };
});
