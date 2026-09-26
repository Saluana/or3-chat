import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    clientCanaryStepFromEvidence,
    pluginPackageServices,
    readPackageGrantReview,
    readPackageManifest,
    readPluginStateSnapshot,
    serverCandidateDryRun,
} from '../../../../../admin/plugins/package-operation-support';
import { readPackageClientEntry } from '../../../../../admin/plugins/package-client-entry';

const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(),
    clientId: z.string().min(1).max(128).optional(),
});

/**
 * Run the candidate canary.
 *
 * The server half (pointer, grants, state, stored bytes, server routes) runs
 * here. A candidate that declares a contained client runtime cannot pass on the
 * server alone, so the response includes a single-use ticket: the admin's browser
 * performs a hidden activation against the candidate's exact bytes and reports
 * the outcome back to `.../canary/client`.
 */
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
    const clientId = body.data.clientId ?? 'admin-browser-canary';
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const pointer = await services.pointers.readPointer(pluginId);
    if (!pointer?.candidate) {
        throw createError({ statusCode: 409, statusMessage: 'No package candidate is available' });
    }
    const packageDigest = pointer.candidate.packageDigest;
    const result = await services.canary.run({
        pluginId,
        workspaceId,
        packageDigest,
        clientId,
        snapshotState: () => readPluginStateSnapshot(services, workspaceId, pluginId),
        readGrantReview: (candidate) =>
            readPackageGrantReview({
                packages: services.packages,
                settings: services.settings,
                workspaceId,
                pluginId: candidate.pluginId,
                packageDigest: candidate.packageDigest,
                release: null,
            }),
        serverDryRun: (dryRun) => serverCandidateDryRun(services.packages, dryRun),
        clientHiddenPrepare: clientCanaryStepFromEvidence(services.clientCanary, {
            pluginId,
            packageDigest,
            workspaceId,
        }),
    });

    // A pending client step is expected, not a failure: hand the browser what it
    // needs to produce the evidence and let the operator retry the canary.
    if (result.status === 'blocked' && result.stage === 'client-canary') {
        const manifest = await readPackageManifest(services.packages.packagePath(pluginId, packageDigest));
        const clientEntry = await readPackageClientEntry({
            pluginId,
            packageDigest,
            manifest,
            requireSelected: false,
        });
        if (clientEntry) {
            const grants = await readPackageGrantReview({
                packages: services.packages,
                settings: services.settings,
                workspaceId,
                pluginId,
                packageDigest,
                release: null,
            });
            const ticket = await services.clientCanary.issueTicket({
                pluginId,
                packageDigest,
                workspaceId,
                clientId,
                profile: 'or3-portable-client-v1',
                clientEntry,
                grants,
            });
            return {
                ok: false,
                workspaceId,
                ...result,
                clientCanary: {
                    status: 'awaiting-client' as const,
                    ticket,
                },
            };
        }
    }

    return { ok: result.status === 'passed', workspaceId, ...result };
});
