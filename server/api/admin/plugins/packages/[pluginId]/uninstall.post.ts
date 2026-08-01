import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { PluginPackageLifecycleService } from '../../../../../admin/plugins/package-lifecycle';

const BodySchema = z.object({ workspaceId: z.string().min(1).optional() });

/** Removes the selected pointer only after disabling the package in this
 * workspace. Immutable bytes and workspace state deliberately remain intact. */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    const body = BodySchema.safeParse(await readBody(event));
    if (!pluginId || !body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const lifecycle = new PluginPackageLifecycleService(
        packages,
        pointers,
        getWorkspaceSettingsStore(event)
    );
    const disabled = await lifecycle.disable(workspaceId, pluginId);
    const result = await lifecycle.uninstallPackage(pluginId);
    await event.context.adminHooks?.doAction('admin.plugin:action:uninstalled-v2', {
        id: pluginId,
        workspaceId,
        retainedPackageDigests: result.retainedPackageDigests,
    });
    return { ok: true, workspaceId, enabled: disabled, ...result };
});
