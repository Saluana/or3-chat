import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    packageGrantCandidate,
    pluginPackageServices,
    readPackageGrantReview,
    readPackageManifest,
    readPluginStateSnapshot,
    restorePluginStateSnapshot,
} from '../../../../../admin/plugins/package-operation-support';
import { getEnabledPlugins, setPluginEnabled } from '../../../../../admin/plugins/workspace-plugin-store';
import {
    acquisitionServiceFor,
    listAllWorkspaceIds,
} from '../../../../../utils/plugins/acquisition/route-support';
import { requesterIdentity } from '../../../../../utils/plugins/acquisition/route-identity';
import { promoteScopedSetupValues } from '../../../../../utils/plugins/setup/settings-store';

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
    // not become a side door that skips them. The checks fail closed: a promotion
    // that cannot be checked is refused, not waved through.
    let acquisition: Awaited<ReturnType<typeof acquisitionServiceFor>>;
    try {
        acquisition = await acquisitionServiceFor(event, requesterIdentity(context));
    } catch (error) {
        throw createError({
            statusCode: 503,
            statusMessage: `The install pipeline could not be checked, so this promotion was refused: ${
                error instanceof Error ? error.message : 'unknown error'
            }`,
            data: { code: 'preflight-unavailable' },
        });
    }
    const operations = await acquisition.listForPlugin(pluginId).catch(() => {
            throw createError({
                statusCode: 503,
                statusMessage: 'The recorded install operations could not be read.',
                data: { code: 'preflight-unavailable' },
            });
        });
    const owned = operations.find(
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
    const setupOperation = operations.find(
        (operation) =>
            operation.candidateDigest === body.data.candidateDigest &&
            operation.status !== 'completed' &&
            operation.status !== 'canceled'
    );

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
    const preflight = await acquisition.preflightWorkspaces(
        pluginId,
        await packageGrantCandidate({
            packagePath: services.packages.packagePath(
                pluginId,
                body.data.candidateDigest as `sha256-${string}`
            ),
            packageDigest: body.data.candidateDigest as `sha256-${string}`,
        }),
        {
            operationId: setupOperation?.operationId ?? 'direct-promotion',
            includeWorkspaceId: workspaceId,
        }
    );
    if (preflight.blocking.length > 0) {
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
                release: null,
            }),
        restoreState: (snapshot) =>
            restorePluginStateSnapshot(services, workspaceId, pluginId, snapshot),
        prepareSetupPromotion: async ({ running }) => {
            const workspaceIds = new Set(await listAllWorkspaceIds(event));
            workspaceIds.add(workspaceId);
            const undos: Array<() => void | Promise<void>> = [];
            const rollback = async () => {
                let rollbackFailure: unknown;
                for (const undo of [...undos].reverse()) {
                    try {
                        await undo();
                    } catch (undoError) {
                        rollbackFailure ??= undoError;
                    }
                }
                if (rollbackFailure) throw rollbackFailure;
            };
            try {
                for (const targetWorkspaceId of workspaceIds) {
                    const enabled = await getEnabledPlugins(
                        services.settings,
                        targetWorkspaceId
                    );
                    if (
                        targetWorkspaceId !== workspaceId &&
                        !enabled.includes(pluginId)
                    ) {
                        continue;
                    }
                    const undo = await promoteScopedSetupValues(
                        services.settings,
                        targetWorkspaceId,
                        pluginId,
                        body.data.candidateDigest,
                        setupOperation?.operationId ?? 'direct-promotion',
                        // Inherit from the verified running version (the
                        // recovered previous when current is unreadable), never
                        // from an unverified pointer slot.
                        running?.packageDigest ?? null
                    );
                    if (undo) undos.push(undo);
                }
            } catch (error) {
                await rollback();
                throw error;
            }
            return rollback;
        },
    });
    if (result.status === 'promoted') {
        // A first promotion installs the plugin for this workspace, so it is
        // enabled here too: the runtime gate refuses a disabled package, and
        // "promoted" without enablement would be a version nothing runs. An
        // update leaves enablement as the workspace set it, even when a failed
        // current had to be dropped and the new pointer retains no previous.
        if (!result.wasInstalled) {
            await setPluginEnabled(services.settings, workspaceId, pluginId, true);
        }
        // Live-handle revocation happens in the promotion service's own commit
        // hook, which every promotion caller shares.
        await event.context.adminHooks?.doAction('admin.plugin:action:promoted', {
            id: pluginId,
            workspaceId,
            packageDigest: body.data.candidateDigest,
        });
    }
    return { ok: result.status === 'promoted', workspaceId, ...result };
});
