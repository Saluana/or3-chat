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
import { assertExpectedAdminWorkspace, resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    packageGrantCandidate,
    pluginPackageServices,
    readPackageManifest,
} from '../../../../../admin/plugins/package-operation-support';
import {
    getEnabledPlugins,
    setPluginGrantReview,
    type PluginGrantCandidate,
} from '../../../../../admin/plugins/workspace-plugin-store';
import { enabledWorkspaceFingerprint } from '../../../../../admin/plugins/rollback-workspaces';
import { isSiteReleaseStillApproved } from '../../../../../admin/plugins/site-policy-service';
import {
    acquisitionServiceFor,
    registryClientFor,
    listAllWorkspaceIds,
} from '../../../../../utils/plugins/acquisition/route-support';
import { acquisitionConfig } from '../../../../../utils/plugins/acquisition/config';
import { RegistryStateStore } from '../../../../../utils/plugins/acquisition/registry-state';
import { requesterIdentity } from '../../../../../utils/plugins/acquisition/route-identity';
import { readLocalAdmission } from '../../../../../admin/plugins/local-admission';
import { readAdminUploadProvenance } from '../../../../../admin/plugins/admin-upload-provenance';

const DigestSchema = z.string().regex(/^sha256-[a-f0-9]{64}$/);

const BodySchema = z
    .object({
        approvedGrants: z.array(z.string().min(1).max(64)).max(64),
        /** Canonical extracted package-tree digest the reviewer saw. */
        expectedPackageDigest: DigestSchema.nullable(),
        /** Signed authority hash the reviewer saw. */
        expectedAuthoritySha256: DigestSchema,
        version: z.string().min(1).max(64).optional(),
        target: z.enum(['candidate', 'current']).optional(),
        workspaceId: z.string().min(1).optional(),
        expectedWorkspaceId: z.string().min(1).optional(),
        deploymentWide: z.boolean().optional(),
        expectedEnabledWorkspaceSha256: DigestSchema.optional(),
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
    assertExpectedAdminWorkspace(context, body.data.expectedWorkspaceId);
    if (body.data.deploymentWide && body.data.workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Choose either deployment-wide or one workspace.' });
    }
    if (body.data.deploymentWide && !body.data.expectedEnabledWorkspaceSha256) {
        throw createError({ statusCode: 400, statusMessage: 'Review the enabled workspace set before approving this release.' });
    }
    if (body.data.deploymentWide && !body.data.version) {
        throw createError({ statusCode: 400, statusMessage: 'Review one exact site-approved version before approving enabled workspaces.' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));

    const pointer = await services.pointers.readPointer(pluginId).catch(() => null);
    let candidate: PluginGrantCandidate;
    if (body.data.target === 'current') {
        const packageDigest = pointer?.current?.packageDigest;
        if (!packageDigest || body.data.expectedPackageDigest !== packageDigest) {
            throw createError({ statusCode: 409, statusMessage: 'The selected package changed since review.', data: { code: 'candidate-digest-mismatch' } });
        }
        await services.packages.verifyStoredPackage(pluginId, packageDigest);
        const packagePath = services.packages.packagePath(pluginId, packageDigest);
        const manifest = await readPackageManifest(packagePath);
        if (body.data.version && body.data.version !== manifest.version) {
            throw createError({ statusCode: 409, statusMessage: 'The selected package version changed since review.' });
        }
        const explicitAdmission = await readLocalAdmission(pluginId, packageDigest) ||
            await readAdminUploadProvenance(pluginId, packageDigest);
        if (explicitAdmission) {
            candidate = await packageGrantCandidate({ packagePath, packageDigest });
        } else {
            const state = new RegistryStateStore();
            const registryState = await state.read();
            const client = registryClientFor(acquisitionConfig(), registryState.acceptedAdvisorySequence, state, registryState.acceptedAdvisoryCheckpoint);
            const release = await client.resolveRelease({ expectation: { pluginId, version: manifest.version } });
            if (!release.ok || release.value.document.packageTreeSha256 !== packageDigest ||
                release.value.document.authoritySha256 !== body.data.expectedAuthoritySha256) {
                throw createError({ statusCode: 409, statusMessage: 'The selected package does not match the signed release.' });
            }
            const document = release.value.document;
            candidate = await packageGrantCandidate({
                packagePath, packageDigest,
                release: {
                    releaseId: document.releaseId,
                    authoritySha256: document.authoritySha256,
                    ...(document.authority === undefined ? {} : { authority: document.authority }),
                },
            });
        }
    } else if (pointer?.candidate) {
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
            body.data.expectedPackageDigest === operation.release.packageTreeSha256;
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

    const saved = await services.packages.runPluginOperation(pluginId, async () => {
        const retainedPointer = await services.pointers.readPointer(pluginId);
        const retainPackageDigests = [
            retainedPointer?.current?.packageDigest,
            retainedPointer?.candidate?.packageDigest,
            retainedPointer?.previous?.packageDigest,
        ].filter((digest): digest is NonNullable<typeof digest> => Boolean(digest));
        if (body.data.deploymentWide && (!candidate.releaseId || !candidate.packageDigest ||
            !await isSiteReleaseStillApproved(pluginId, {
                version: body.data.version!, packageTreeSha256: candidate.packageDigest as `sha256-${string}`,
                releaseId: candidate.releaseId, authoritySha256: candidate.authoritySha256!,
            }))) {
            throw createError({ statusCode: 409, statusMessage: 'Site approval changed. Review this exact release again.',
                data: { code: 'site-approval-required' } });
        }
        const workspaceIds = body.data.deploymentWide
            ? [...new Set([workspaceId, ...await listAllWorkspaceIds(event)])].sort()
            : [workspaceId];
        const targets: string[] = [];
        if (body.data.deploymentWide) {
            for (let offset = 0; offset < workspaceIds.length; offset += 25) {
                const chunk = workspaceIds.slice(offset, offset + 25);
                const flags = await Promise.all(chunk.map(async (id) =>
                    (await getEnabledPlugins(services.settings, id)).includes(pluginId)));
                for (let index = 0; index < chunk.length; index++) if (flags[index]) targets.push(chunk[index]!);
            }
            if (enabledWorkspaceFingerprint(targets) !== body.data.expectedEnabledWorkspaceSha256) {
                throw createError({ statusCode: 409, statusMessage: 'The enabled workspace set changed. Refresh the update review.',
                    data: { code: 'enabled-workspace-set-changed' } });
            }
            // Acquisition checks its initiating workspace even if that
            // workspace is disabled. Record consent there for the canary, but
            // never change its enablement as part of approval.
            if (!targets.includes(workspaceId)) targets.push(workspaceId);
            targets.sort();
        } else targets.push(workspaceId);
        let reviewed = 0;
        let review: Awaited<ReturnType<typeof setPluginGrantReview>> | null = null;
        const notified: Array<{ targetId: string; review: Awaited<ReturnType<typeof setPluginGrantReview>> }> = [];
        const failed: string[] = [];
        for (let offset = 0; offset < targets.length; offset += 25) {
            const chunk = targets.slice(offset, offset + 25);
            const outcomes = await Promise.allSettled(chunk.map((targetId) => setPluginGrantReview(services.settings, targetId, pluginId, {
                candidate, approvedGrants: approved, reviewedBy: requesterIdentity(context), retainPackageDigests,
            })));
            for (let index = 0; index < chunk.length; index++) {
                const outcome = outcomes[index]!;
                const targetId = chunk[index]!;
                if (outcome.status === 'rejected') { failed.push(targetId); continue; }
                review = outcome.value;
                reviewed += 1;
                notified.push({ targetId, review });
            }
        }
        return { workspaceId, reviewedWorkspaces: reviewed, review, notified, failed };
    });
    for (const { targetId, review } of saved.notified) {
        try {
            await event.context.adminHooks?.doAction('admin.plugin:action:grants-reviewed', {
                id: pluginId, workspaceId: targetId,
                approvedGrants: [...review.approvedGrants],
                packageDigest: review.packageDigest,
                authoritySha256: review.authoritySha256,
            });
        } catch {
            console.warn('[plugin-grants] Post-commit admin hook failed', { pluginId, workspaceId: targetId });
        }
    }
    if (saved.failed.length) throw createError({
        statusCode: 503,
        statusMessage: `Approval was saved for ${saved.reviewedWorkspaces} workspace(s), but failed in ${saved.failed.length}. Retry this exact release after checking the failed workspaces.`,
        data: { code: 'workspace-grant-write-failed', workspaceId: saved.failed[0],
            reviewedWorkspaces: saved.reviewedWorkspaces, failedCount: saved.failed.length,
            failedWorkspaces: saved.failed.slice(0, 25) },
    });
    return { ok: true, workspaceId, reviewedWorkspaces: saved.reviewedWorkspaces, review: saved.review };
});
