import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { packageGrantCandidate, pluginPackageServices, readPackageManifest } from '../../../../../admin/plugins/package-operation-support';
import { getPluginGrantReview } from '../../../../../admin/plugins/workspace-plugin-store';
import { acquisitionServiceFor, registryClientFor } from '../../../../../utils/plugins/acquisition/route-support';
import { acquisitionConfig } from '../../../../../utils/plugins/acquisition/config';
import { RegistryStateStore } from '../../../../../utils/plugins/acquisition/registry-state';
import { requesterIdentity } from '../../../../../utils/plugins/acquisition/route-identity';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';
import type { EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import { readLocalAdmission } from '../../../../../admin/plugins/local-admission';
import { readAdminUploadProvenance } from '../../../../../admin/plugins/admin-upload-provenance';

/** Owner-only preview of the exact selected or inactive package's reviewable authority. */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        superAdminOnly: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    if (!pluginId) throw createError({ statusCode: 400, statusMessage: 'Missing plugin id' });
    const query = getQuery(event);
    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        typeof query.workspaceId === 'string' ? query.workspaceId : undefined
    );
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const pointer = await services.pointers.readPointer(pluginId);
    const target = query.target === 'current' ? 'current' : 'candidate';
    const digest = target === 'current'
        ? pointer?.current?.packageDigest
        : pointer?.candidate?.packageDigest ?? pointer?.current?.packageDigest;
    if (!digest) throw createError({ statusCode: 404, statusMessage: 'No package to review' });
    await services.packages.verifyStoredPackage(pluginId, digest);
    const packagePath = services.packages.packagePath(pluginId, digest);
    const manifest = await readPackageManifest(packagePath);
    let release: {
        releaseId: string;
        authoritySha256: Sha256;
        authority?: EffectiveAuthority;
    } | null = null;
    const operations = await (await acquisitionServiceFor(event, requesterIdentity(context)))
        .listForPlugin(pluginId).catch(() => []);
    const operation = operations.find((entry) => entry.candidateDigest === digest);
    if (target === 'candidate' && operation?.release) {
        release = operation.release;
    } else if ((target === 'current' || !pointer?.candidate) &&
        !await readLocalAdmission(pluginId, digest) &&
        !await readAdminUploadProvenance(pluginId, digest)) {
        const state = new RegistryStateStore();
        const registryState = await state.read();
        const client = registryClientFor(acquisitionConfig(), registryState.acceptedAdvisorySequence, state, registryState.acceptedAdvisoryCheckpoint);
        const resolved = await client.resolveRelease({ expectation: { pluginId, version: manifest.version } });
        if (!resolved.ok || resolved.value.document.packageTreeSha256 !== digest) {
            throw createError({ statusCode: 409, statusMessage: 'Selected package does not match the signed release' });
        }
        release = resolved.value.document;
    }
    const candidate = await packageGrantCandidate({
        packagePath,
        packageDigest: digest,
        release: release
            ? {
                releaseId: release.releaseId,
                authoritySha256: release.authoritySha256,
                ...(release.authority === undefined
                    ? {}
                    : { authority: release.authority }),
            }
            : null,
    });
    if (!candidate.authoritySha256) {
        throw createError({ statusCode: 409, statusMessage: 'Candidate authority is not verifiable' });
    }
    const review = await getPluginGrantReview(services.settings, workspaceId, pluginId, candidate);
    return {
        pluginId,
        workspaceId,
        target: target === 'candidate' && !pointer?.candidate ? 'current' : target,
        packageDigest: digest,
        version: manifest.version,
        authoritySha256: candidate.authoritySha256,
        requestedGrants: candidate.requestedGrants,
        authority: candidate.authority,
        reviewStatus: review.status,
        approvedGrants: review.approvedGrants,
    };
});
