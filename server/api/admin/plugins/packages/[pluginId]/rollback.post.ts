import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    pluginPackageServices,
    readPluginStateSnapshot,
    restorePluginStateSnapshot,
} from '../../../../../admin/plugins/package-operation-support';

const BodySchema = z.object({ workspaceId: z.string().min(1).optional() });

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    const body = BodySchema.safeParse(await readBody(event));
    if (!pluginId || !body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const result = await services.promotion.rollback({
        pluginId,
        storedStateVersion: await services.migration.getStateVersion(workspaceId, pluginId),
        snapshotState: () => readPluginStateSnapshot(services, workspaceId, pluginId),
        restoreState: (snapshot) =>
            restorePluginStateSnapshot(services, workspaceId, pluginId, snapshot),
    });
    if (result.status === 'rolled-back') {
        await event.context.adminHooks?.doAction('admin.plugin:action:rolled-back', {
            id: pluginId,
            workspaceId,
        });
    }
    return { ok: result.status === 'rolled-back', workspaceId, ...result };
});
