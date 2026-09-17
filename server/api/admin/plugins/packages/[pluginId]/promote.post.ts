import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    pluginPackageServices,
    readPackageGrantReview,
    readPluginStateSnapshot,
    restorePluginStateSnapshot,
} from '../../../../../admin/plugins/package-operation-support';

const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(),
    candidateDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
});

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
    const result = await services.promotion.promote({
        pluginId,
        workspaceId,
        expectedCandidateDigest: body.data.candidateDigest as `sha256-${string}`,
        storedStateVersion: await services.migration.getStateVersion(workspaceId, pluginId),
        snapshotState: () => readPluginStateSnapshot(services, workspaceId, pluginId),
        readGrantReview: (candidate) =>
            readPackageGrantReview({
                packages: services.packages,
                settings: services.settings,
                workspaceId,
                pluginId: candidate.pluginId,
                packageDigest: candidate.packageDigest,
            }),
        restoreState: (snapshot) =>
            restorePluginStateSnapshot(services, workspaceId, pluginId, snapshot),
    });
    if (result.status === 'promoted') {
        await event.context.adminHooks?.doAction('admin.plugin:action:promoted', {
            id: pluginId,
            workspaceId,
            packageDigest: body.data.candidateDigest,
        });
    }
    return { ok: result.status === 'promoted', workspaceId, ...result };
});
