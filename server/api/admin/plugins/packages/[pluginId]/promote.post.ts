import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    pluginPackageServices,
    readPackageGrantReview,
    readPackageManifest,
    readPluginStateSnapshot,
    restorePluginStateSnapshot,
} from '../../../../../admin/plugins/package-operation-support';
import { acquisitionServiceFor } from '../../../../../utils/plugins/acquisition/route-support';

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

    // A candidate staged by an install operation belongs to that operation: the
    // pipeline owns preflight, setup readiness and the canary, so promotion must
    // not become a side door that skips them.
    const acquisition = await acquisitionServiceFor(event).catch(() => null);
    if (acquisition) {
        const owned = (await acquisition.listForPlugin(pluginId).catch(() => [])).find(
            (operation) =>
                operation.candidateDigest === body.data.candidateDigest &&
                operation.status !== 'completed' &&
                operation.status !== 'canceled'
        );
        if (owned) {
            throw createError({
                statusCode: 409,
                statusMessage: `This candidate belongs to install operation ${owned.operationId}; resume that operation instead of promoting it directly.`,
                data: { code: 'acquisition-required', operationId: owned.operationId },
            });
        }
    }

    // The instance-wide preflight protects every enabled workspace, whatever
    // created the candidate: one selected version is shared by all of them.
    const candidateManifest = await readPackageManifest(
        services.packages.packagePath(pluginId, body.data.candidateDigest as `sha256-${string}`)
    ).catch(() => null);
    if (!candidateManifest) {
        throw createError({
            statusCode: 409,
            statusMessage: 'The stored candidate package is unreadable.',
        });
    }
    const preflight = await acquisition?.preflightWorkspaces(
        pluginId,
        candidateManifest.requestedGrants
    );
    if (preflight && preflight.blocking.length > 0) {
        const detail = preflight.blocking
            .map((entry) => `${entry.workspaceId} (${entry.code})`)
            .join(', ');
        throw createError({
            statusCode: 409,
            statusMessage: `An owner must disable these workspaces before this version can be selected: ${detail}`,
            data: { code: 'workspace-preflight-blocked' },
        });
    }

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
