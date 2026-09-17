import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    pluginPackageServices,
    readPackageGrantReview,
    readPluginStateSnapshot,
    serverCandidateDryRun,
} from '../../../../../admin/plugins/package-operation-support';

const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(),
    clientId: z.string().min(1).max(128).optional(),
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
    const pointer = await services.pointers.readPointer(pluginId);
    if (!pointer?.candidate) {
        throw createError({ statusCode: 409, statusMessage: 'No package candidate is available' });
    }
    const result = await services.canary.run({
        pluginId,
        workspaceId,
        packageDigest: pointer.candidate.packageDigest,
        clientId: body.data.clientId ?? 'admin-server-only-canary',
        snapshotState: () => readPluginStateSnapshot(services, workspaceId, pluginId),
        readGrantReview: (candidate) =>
            readPackageGrantReview({
                packages: services.packages,
                settings: services.settings,
                workspaceId,
                pluginId: candidate.pluginId,
                packageDigest: candidate.packageDigest,
            }),
        serverDryRun: (dryRun) => serverCandidateDryRun(services.packages, dryRun),
        // Client V2 activation has its own ABI release gate. A server-only
        // candidate records that fact rather than fabricating a browser pass.
        clientHiddenPrepare: () => ({ status: 'skipped' as const, code: 'server-only-profile' }),
    });
    return { ok: result.status === 'passed', workspaceId, ...result };
});
