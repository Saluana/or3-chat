/**
 * Record the explicit workspace consent for one plugin's requested authority.
 *
 * A first install that asks for grants cannot proceed without this: the
 * acquisition pipeline refuses a release whose authority was never reviewed, and
 * setup cannot supply the consent. The requested set is never taken from the
 * request body - it is read from the staged candidate's own manifest when one
 * exists, or re-derived from the signed release metadata, so a caller can only
 * narrow the approved set, never widen it.
 *
 * The approval binds to the exact candidate the reviewer saw: the request must
 * carry the expected package digest and signed authority hash, and a candidate
 * that changed between display and save is refused instead of silently
 * approved.
 */
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    packageGrantCandidate,
    pluginPackageServices,
} from '../../../../../admin/plugins/package-operation-support';
import {
    getEnabledPlugins,
    setPluginGrantReview,
    type PluginGrantCandidate,
} from '../../../../../admin/plugins/workspace-plugin-store';
import {
    acquisitionServiceFor,
    registryClientFor,
    listAllWorkspaceIds,
} from '../../../../../utils/plugins/acquisition/route-support';
import { acquisitionConfig } from '../../../../../utils/plugins/acquisition/config';
import { RegistryStateStore } from '../../../../../utils/plugins/acquisition/registry-state';
import { requesterIdentity } from '../../../../../utils/plugins/acquisition/route-identity';

const DigestSchema = z.string().regex(/^sha256-[a-f0-9]{64}$/);

const BodySchema = z
    .object({
        approvedGrants: z.array(z.string().min(1).max(64)).max(64),
        /** Canonical extracted package-tree digest the reviewer saw. */
        expectedPackageDigest: DigestSchema.nullable(),
        /** Signed authority hash the reviewer saw. */
        expectedAuthoritySha256: DigestSchema,
        version: z.string().min(1).max(64).optional(),
        workspaceId: z.string().min(1).optional(),
        deploymentWide: z.boolean().optional(),
    })
    .strict();

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
    if (body.data.deploymentWide && body.data.workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Choose either deployment-wide or one workspace.' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));

    // The staged candidate is the exact bytes a promotion will check, so its
    // digest and authority are the only ones this approval may cover.
    const pointer = await services.pointers.readPointer(pluginId).catch(() => null);
    let candidate: PluginGrantCandidate;
    if (pointer?.candidate) {
        const packageDigest = pointer.candidate.packageDigest;
        const operations = await (
            await acquisitionServiceFor(event, requesterIdentity(context))
        )
            .listForPlugin(pluginId)
            .catch(() => []);
        const operation = operations.find(
            (entry) => entry.candidateDigest === packageDigest
        );
        // The reviewer may have seen either the staged package-tree digest or
        // the signed package-tree digest that produced it; anything else is a
        // changed candidate. The archive digest identifies transport bytes,
        // while consent is bound to the immutable extracted package tree used
        // by the runtime and promotion services.
        const matchesStaged = body.data.expectedPackageDigest === packageDigest;
        const matchesSignedArtifact =
            operation !== undefined &&
            body.data.expectedPackageDigest === operation.release?.packageTreeSha256;
        if (!matchesStaged && !matchesSignedArtifact) {
            throw createError({
                statusCode: 409,
                statusMessage:
                    'The staged candidate changed since the permissions were displayed. Reload and review the current candidate.',
                data: { code: 'candidate-digest-mismatch' },
            });
        }
        candidate = await packageGrantCandidate({
            packagePath: services.packages.packagePath(pluginId, packageDigest),
            packageDigest,
            release: operation?.release
                ? {
                    releaseId: operation.release.releaseId,
                      authoritySha256: operation.release.authoritySha256,
                      ...(operation.release.authority === undefined
                          ? {}
                          : { authority: operation.release.authority }),
                  }
                : null,
        });
    } else {
        const config = acquisitionConfig();
        const state = new RegistryStateStore();
        const registryState = await state.read();
        const client = registryClientFor(
            config,
            registryState.acceptedAdvisorySequence,
            state,
            registryState.acceptedAdvisoryCheckpoint
        );
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
        const document = release.value.document;
        if (document.authoritySha256 !== body.data.expectedAuthoritySha256) {
            throw createError({
                statusCode: 409,
                statusMessage:
                    'The signed release authority changed since the permissions were displayed. Reload and review the current release.',
                data: { code: 'authority-mismatch' },
            });
        }
        if (
            body.data.expectedPackageDigest !== null &&
            body.data.expectedPackageDigest !== document.packageTreeSha256
        ) {
            throw createError({
                statusCode: 409,
                statusMessage:
                    'The signed package tree changed since the permissions were displayed.',
                data: { code: 'candidate-digest-mismatch' },
            });
        }
        // No package bytes are staged yet, so bind consent to the signed
        // package-tree digest. The archive digest is transport provenance and
        // must not be compared with the tree digest used by acquisition.
        candidate = {
            requestedGrants: document.requestedGrants,
            releaseId: document.releaseId,
            packageDigest: document.packageTreeSha256,
            authoritySha256: document.authoritySha256,
            authority: document.authority ?? null,
        };
    }

    if (candidate.authoritySha256 !== body.data.expectedAuthoritySha256) {
        throw createError({
            statusCode: 409,
            statusMessage:
                'The candidate authority changed since the permissions were displayed. Reload and review the current candidate.',
            data: { code: 'authority-mismatch' },
        });
    }

    const approved = [...new Set(body.data.approvedGrants)];
    if (!approved.every((grant) => candidate.requestedGrants.includes(grant))) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The approved grants must be among the authority the release requests.',
        });
    }

    const workspaceIds = body.data.deploymentWide
        ? new Set([workspaceId, ...await listAllWorkspaceIds(event)])
        : new Set([workspaceId]);
    let reviewed = 0;
    let review: Awaited<ReturnType<typeof setPluginGrantReview>> | null = null;
    for (const targetId of workspaceIds) {
        if (targetId !== workspaceId &&
            !(await getEnabledPlugins(services.settings, targetId)).includes(pluginId)) continue;
        try {
            review = await setPluginGrantReview(services.settings, targetId, pluginId, {
                candidate,
                approvedGrants: approved,
                reviewedBy: requesterIdentity(context),
            });
        } catch {
            throw createError({
                statusCode: 503,
                statusMessage: `Approval could not be saved for workspace ${targetId}. ${reviewed} workspace approval(s) were saved; retry this release to finish.`,
                data: { code: 'workspace-grant-write-failed', workspaceId: targetId, reviewedWorkspaces: reviewed },
            });
        }
        reviewed += 1;
        await event.context.adminHooks?.doAction('admin.plugin:action:grants-reviewed', {
            id: pluginId,
            workspaceId: targetId,
            approvedGrants: [...review.approvedGrants],
            packageDigest: review.packageDigest,
            authoritySha256: review.authoritySha256,
        });
    }
    return { ok: true, workspaceId, reviewedWorkspaces: reviewed, review };
});
