import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../../../../admin/stores/registry';
import {
    clientCanaryStepFromEvidence,
    pluginPackageServices,
    readPackageGrantReview,
    readPluginStateSnapshot,
    serverCandidateDryRun,
} from '../../../../../../admin/plugins/package-operation-support';

const BodySchema = z.object({
    ticketId: z.string().min(1).max(128),
    nonce: z.string().min(1).max(128),
    browser: z.string().min(1).max(64),
    abiVersion: z.number().int().min(0).max(1000),
    status: z.enum(['passed', 'blocked']),
    code: z.string().min(1).max(128).optional(),
    diagnostics: z.unknown().optional(),
});

/**
 * Record the browser's canary report, then re-run the canary so the client step
 * sees the evidence it just produced. The ticket is single-use and bound to the
 * plugin, digest, workspace and client id, so a pass cannot be replayed.
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
        throw createError({ statusCode: 400, statusMessage: 'Invalid canary report' });
    }
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const ticket = await services.clientCanary.redeemTicket({
        ticketId: body.data.ticketId,
        nonce: body.data.nonce,
        browser: body.data.browser,
        abiVersion: body.data.abiVersion,
        status: body.data.status,
        ...(body.data.code === undefined ? {} : { code: body.data.code }),
    });
    if (!ticket) {
        throw createError({
            statusCode: 409,
            statusMessage: 'The canary ticket is unknown, expired or already used',
        });
    }
    if (ticket.pluginId !== pluginId) {
        throw createError({ statusCode: 409, statusMessage: 'Canary ticket is for another plugin' });
    }
    await services.clientCanary.recordEvidence({
        schemaVersion: 1,
        pluginId: ticket.pluginId,
        packageDigest: ticket.packageDigest,
        workspaceId: ticket.workspaceId,
        clientId: ticket.clientId,
        profile: ticket.profile,
        browser: body.data.browser,
        abiVersion: body.data.abiVersion,
        status: body.data.status,
        ...(body.data.code === undefined ? {} : { code: body.data.code }),
        ...(body.data.diagnostics === undefined
            ? {}
            : {
                  diagnostics:
                      services.clientCanary.normalizeDiagnostics(body.data.diagnostics) ?? {},
              }),
        recordedAt: Date.now(),
    });

    const result = await services.canary.run({
        pluginId,
        workspaceId: ticket.workspaceId,
        packageDigest: ticket.packageDigest,
        clientId: ticket.clientId,
        snapshotState: () =>
            readPluginStateSnapshot(services, ticket.workspaceId, ticket.pluginId),
        readGrantReview: (candidate) =>
            readPackageGrantReview({
                packages: services.packages,
                settings: services.settings,
                workspaceId: ticket.workspaceId,
                pluginId: candidate.pluginId,
                packageDigest: candidate.packageDigest,
                release: null,
            }),
        serverDryRun: (dryRun) => serverCandidateDryRun(services.packages, dryRun),
        clientHiddenPrepare: clientCanaryStepFromEvidence(services.clientCanary, {
            pluginId: ticket.pluginId,
            packageDigest: ticket.packageDigest,
            workspaceId: ticket.workspaceId,
        }),
    });
    return { ok: result.status === 'passed', workspaceId: ticket.workspaceId, ...result };
});
