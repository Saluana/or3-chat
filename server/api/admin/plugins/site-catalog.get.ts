import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { readCatalogPage, marketplaceRegistryConfigured } from '../../../utils/plugins/marketplace/service';
import { ensureSitePolicyMigrated } from '../../../admin/plugins/site-policy-service';
import { SitePluginPolicyStore } from '../../../admin/plugins/site-policy';

/** Full registry discovery is reserved for site administrators. */
export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const policyStore = new SitePluginPolicyStore();
    await ensureSitePolicyMigrated(policyStore);
    const catalog = await readCatalogPage(getRequestURL(event).searchParams);
    return {
        configured: marketplaceRegistryConfigured(),
        catalog,
        policies: (await policyStore.list()).map((policy) => ({
            pluginId: policy.pluginId,
            revision: policy.revision,
            catalogVisible: policy.catalogVisible,
            approvedRelease: policy.approvedRelease,
            futureDefaultEnabled: policy.futureDefault?.enabled ?? false,
        })),
    };
});
