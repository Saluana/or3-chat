import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { getEnabledPlugins } from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { preflightMarketplaceInstall } from '../../../utils/plugins/marketplace/service';

type PreflightBody = {
    readonly pluginId?: unknown;
    readonly version?: unknown;
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

    const settingsStore = getWorkspaceSettingsStore(event);
    const [installed, enabled] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId),
    ]);
    const installedPluginIds = installed
        .filter((extension) => extension.kind === 'plugin')
        .map((extension) => extension.id);

    return await preflightMarketplaceInstall({
        pluginId,
        ...(version === undefined ? {} : { version }),
        workspaceId,
        installedPluginIds,
        enabledPluginIds: enabled,
    });
});
