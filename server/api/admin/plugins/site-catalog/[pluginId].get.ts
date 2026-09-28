import { createError, defineEventHandler, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../../admin/api';
import { signedRelease } from '../../../../admin/plugins/site-policy-service';
import { readCatalogEntry } from '../../../../utils/plugins/marketplace/service';
import { SitePluginPolicyStore } from '../../../../admin/plugins/site-policy';

/** Signed authority preview for one exact release before approval. */
export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const pluginId = getRouterParam(event, 'pluginId') ?? '';
    const version = getQuery(event).version;
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId) || typeof version !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(version)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid release identity' });
    }
    const [release, entry, policy] = await Promise.all([
        signedRelease(pluginId, version),
        readCatalogEntry(pluginId),
        new SitePluginPolicyStore().read(pluginId),
    ]);
    return {
        pluginId,
        version,
        releaseId: release.releaseId,
        packageTreeSha256: release.packageTreeSha256,
        authoritySha256: release.authoritySha256,
        requestedGrants: release.requestedGrants,
        authority: release.authority ?? null,
        name: entry && typeof entry === 'object' && 'name' in entry ? entry.name : pluginId,
        current: policy ? { revision: policy.revision, catalogVisible: policy.catalogVisible, approvedRelease: policy.approvedRelease } : null,
    };
});
