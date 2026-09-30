import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { marketplaceRegistryConfigured } from '../../../utils/plugins/marketplace/service';
import { approvedCatalogPage, ensureSitePolicyMigrated } from '../../../admin/plugins/site-policy-service';
import { SitePluginPolicyStore } from '../../../admin/plugins/site-policy';

/**
 * Browse the configured marketplace through the authenticated local server.
 *
 * The browser never talks to the registry: this host is the configured trusted
 * client, and discovery is a private, no-store response for the signed-in
 * workspace. An instance with no registry answers `configured: false` so the UI
 * can explain the gap instead of showing an empty store.
 */
export default defineEventHandler(async (event) => {
    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const url = getRequestURL(event);
    try {
        if (!marketplaceRegistryConfigured()) return { configured: false, catalog: null };
        const policy = new SitePluginPolicyStore();
        await ensureSitePolicyMigrated(policy);
        const catalog = await approvedCatalogPage(policy, url.searchParams);
        return { configured: true, catalog };
    } catch (error) {
        return {
            configured: true,
            catalog: null,
            notice: error instanceof Error && 'code' in error && error.code === 'policy-invalid'
                ? 'Site plugin approval needs repair by an administrator.'
                : 'The approved catalog could not be loaded. Try again in a moment.',
        };
    }
});
