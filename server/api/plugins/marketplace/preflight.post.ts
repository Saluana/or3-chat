import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { getEnabledPlugins } from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { preflightMarketplaceInstall } from '../../../utils/plugins/marketplace/service';
import { pluginPackageServices } from '../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';

type PreflightBody = {
    readonly pluginId?: unknown;
    readonly version?: unknown;
    /** Browser engine the requesting page detected, for profile qualification. */
    readonly clientEngine?: unknown;
};

/**
 * Assess one marketplace install from this host's point of view.
 *
 * The answer is a list of actionable blocks, not a boolean: registry
 * configuration, signed release and advisories, profile/trust capability, disk
 * headroom and the workspace's own installation state are all reported so the UI
 * can explain exactly what to fix. Read-only and bounded.
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

    const body = await readLimitedJsonBody<PreflightBody | undefined>(event);
    const pluginId = typeof body?.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId)) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    const version =
        typeof body?.version === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(body.version)
            ? body.version
            : undefined;
    const clientEngine =
        typeof body?.clientEngine === 'string' &&
        /^[a-zA-Z0-9._-]{1,64}$/.test(body.clientEngine)
            ? body.clientEngine.toLowerCase()
            : undefined;

    const settingsStore = getWorkspaceSettingsStore(event);
    const services = pluginPackageServices(settingsStore);
    const [installed, enabled, selected] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId),
        new PluginPackageRouteCatalog(services.packages, services.pointers).listSelected(),
    ]);
    const installedPluginIds = installed
        .filter((extension) => extension.kind === 'plugin')
        .map((extension) => extension.id);
    installedPluginIds.push(...selected
        .filter((entry) => entry.status === 'ready')
        .map((entry) => entry.pluginId));

    // The acquisition pipeline refuses a candidate whose package digest is
    // already the selected one. Reading the pointer directly here reports the
    // same answer up front, including when the selected package is present but
    // not routable, instead of after a download and verification pass.
    const selection = await services.pointers.readStartupSelection(pluginId).catch(() => null);
    const selectedPackageDigest =
        selection && selection.status !== 'blocked' ? selection.selected?.packageDigest : undefined;

    return await preflightMarketplaceInstall({
        pluginId,
        ...(version === undefined ? {} : { version }),
        ...(clientEngine === undefined ? {} : { clientEngine }),
        workspaceId,
        installedPluginIds,
        enabledPluginIds: enabled,
        ...(selectedPackageDigest === undefined ? {} : { selectedPackageDigest }),
    });
});
