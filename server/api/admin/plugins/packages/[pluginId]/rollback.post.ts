import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { assertExpectedAdminWorkspace, resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    pluginPackageServices,
    readPluginStateSnapshot,
    restorePluginStateSnapshot,
} from '../../../../../admin/plugins/package-operation-support';
import { revokeHostActivationsForPlugin } from '../../../../../utils/plugins/isolation/activation-registry';
import { prepareRollbackWorkspacePreflight } from '../../../../../admin/plugins/rollback-workspaces';

const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(), expectedWorkspaceId: z.string().min(1).optional(),
    expectedCurrentDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
    expectedPreviousDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
    expectedPointerRevision: z.number().int().nonnegative(),
    expectedEnabledWorkspaceSha256: z.string().regex(/^sha256-[a-f0-9]{64}$/),
}).strict();

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
    assertExpectedAdminWorkspace(context, body.data.expectedWorkspaceId);
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const pointer = await services.pointers.readPointer(pluginId);
    if (!pointer?.current || !pointer.previous || pointer.current.packageDigest !== body.data.expectedCurrentDigest ||
        pointer.previous.packageDigest !== body.data.expectedPreviousDigest || pointer.revision !== body.data.expectedPointerRevision) {
        throw createError({ statusCode: 409, statusMessage: 'The selected version changed. Review rollback again.' });
    }
    let preflightWorkspaces;
    try { preflightWorkspaces = await prepareRollbackWorkspacePreflight(event, services, pluginId, pointer.previous,
        { expectedEnabledWorkspaceSha256: body.data.expectedEnabledWorkspaceSha256 }); }
    catch { throw createError({ statusCode: 409, statusMessage: 'The previous release cannot be verified for rollback.' }); }
    const result = await services.promotion.rollback({
        pluginId,
        expectedCurrentDigest: pointer.current.packageDigest,
        expectedPreviousDigest: pointer.previous.packageDigest,
        expectedPointerRevision: pointer.revision,
        preflightWorkspaces,
        // All enabled workspaces were reviewed by preflightWorkspaces. The
        // initiating admin workspace may be disabled and is not a state target.
        storedStateVersion: null,
        snapshotState: () => readPluginStateSnapshot(services, workspaceId, pluginId),
        restoreState: (snapshot) =>
            restorePluginStateSnapshot(services, workspaceId, pluginId, snapshot),
    });
    if (result.status === 'blocked') {
        throw createError({ statusCode: 409, statusMessage: result.stage === 'workspaces'
            ? `Rollback is blocked in ${result.blocking?.length ?? 0} workspace(s). Refresh the impact review.`
            : `Rollback was refused: ${result.code}.`,
        data: { code: result.code, blocking: result.blocking ?? [] } });
    }
    {
        // The selected package changed for every workspace: revoke live handles
        // so an activation from the rolled-back version cannot keep acting (or
        // saving settings) after the rollback, even if the digest it names is
        // selected again later.
        revokeHostActivationsForPlugin(pluginId, 'selected-package-changed');
        try {
            await event.context.adminHooks?.doAction('admin.plugin:action:rolled-back', {
                id: pluginId,
                workspaceId,
            });
        } catch {
            // A post-commit observer cannot turn a committed pointer swap into
            // an apparent refusal that invites the administrator to retry it.
            console.warn('[plugin-rollback] Post-commit admin hook failed', { pluginId });
        }
    }
    return { ok: true, workspaceId, ...result };
});
