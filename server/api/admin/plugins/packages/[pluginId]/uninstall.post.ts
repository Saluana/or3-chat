import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { PluginPackageLifecycleService } from '../../../../../admin/plugins/package-lifecycle';
import { revokeHostActivationsForPlugin } from '../../../../../utils/plugins/isolation/activation-registry';
import { listAllWorkspaceIds } from '../../../../../utils/plugins/acquisition/route-support';

const BodySchema = z.object({ expectedPackageDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/) });

/** Removes the instance-wide selection after disabling every live workspace. */
export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    const body = BodySchema.safeParse(await readBody(event));
    if (!pluginId || !body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const lifecycle = new PluginPackageLifecycleService(
        packages,
        pointers,
        getWorkspaceSettingsStore(event)
    );
    const workspaceIds = await listAllWorkspaceIds(event);
    const result = await lifecycle.uninstallPackage(pluginId, {
        workspaceIds,
        expectedPackageDigest: body.data.expectedPackageDigest,
    }).catch((error) => {
        if (error instanceof Error && error.message === 'Selected package changed; refresh before uninstalling.') {
            throw createError({ statusCode: 409, statusMessage: error.message });
        }
        throw error;
    });
    // Uninstall ends execution everywhere: revoke live handles and abort their
    // in-flight calls so nothing finishes on removed bytes.
    revokeHostActivationsForPlugin(pluginId, 'plugin-uninstalled');
    try {
        await event.context.adminHooks?.doAction('admin.plugin:action:uninstalled-v2', { id: pluginId, retainedPackageDigests: result.retainedPackageDigests });
    } catch { console.warn('[plugin-uninstall] Post-commit admin hook failed', { pluginId }); }
    return { ok: true, ...result };
});
