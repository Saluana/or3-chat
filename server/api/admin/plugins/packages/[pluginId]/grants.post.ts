/**
 * Record the explicit workspace consent for one plugin's requested authority.
 *
 * A first install that asks for grants cannot proceed without this: the
 * acquisition pipeline refuses a release whose grants were never reviewed, and
 * setup cannot supply the consent. The requested set is never taken from the
 * request body - it is read from the staged candidate's own manifest when one
 * exists, or re-derived from the signed release metadata, so a caller can only
 * narrow the approved set, never widen it.
 */
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    pluginPackageServices,
    readPackageManifest,
} from '../../../../../admin/plugins/package-operation-support';
import { setPluginGrantReview } from '../../../../../admin/plugins/workspace-plugin-store';
import { acquisitionConfig } from '../../../../../utils/plugins/acquisition/config';
import { registryClientFor } from '../../../../../utils/plugins/acquisition/route-support';
import { RegistryStateStore } from '../../../../../utils/plugins/acquisition/registry-state';
import { requesterIdentity } from '../../../../../utils/plugins/acquisition/route-identity';

const BodySchema = z.object({
    approvedGrants: z.array(z.string().min(1).max(64)).max(64),
    version: z.string().min(1).max(64).optional(),
    workspaceId: z.string().min(1).optional(),
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

    // The staged candidate is the exact bytes a promotion will check, so its
    // manifest is the authoritative requested set when it exists.
    const pointer = await services.pointers.readPointer(pluginId).catch(() => null);
    let requestedGrants: readonly string[] | null = null;
    if (pointer?.candidate) {
        const manifest = await readPackageManifest(
            services.packages.packagePath(pluginId, pointer.candidate.packageDigest)
        ).catch(() => null);
        requestedGrants = manifest?.requestedGrants ?? null;
    }
    if (requestedGrants === null) {
        const config = acquisitionConfig();
        const state = new RegistryStateStore();
        const registryState = await state.read();
        const client = registryClientFor(config, registryState.acceptedAdvisorySequence, state);
        const release = await client.resolveRelease({
            expectation: {
                pluginId,
                ...(body.data.version === undefined ? {} : { version: body.data.version }),
            },
        });
        if (!release.ok) {
            throw createError({
                statusCode: 409,
                statusMessage: `The requested authority could not be verified against the signed release: ${release.failure.message}`,
                data: { code: release.failure.code },
            });
        }
        requestedGrants = release.value.document.requestedGrants;
    }

    const approved = [...new Set(body.data.approvedGrants)];
    if (!approved.every((grant) => requestedGrants.includes(grant))) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The approved grants must be among the authority the release requests.',
        });
    }

    const review = await setPluginGrantReview(services.settings, workspaceId, pluginId, {
        requestedGrants,
        approvedGrants: approved,
        reviewedBy: requesterIdentity(context),
    });
    await event.context.adminHooks?.doAction('admin.plugin:action:grants-reviewed', {
        id: pluginId,
        workspaceId,
        approvedGrants: [...review.approvedGrants],
    });
    return { ok: true, workspaceId, review };
});
