import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readCatalogEntry } from '../../../utils/plugins/marketplace/service';
import { approvedSiteRelease } from '../../../admin/plugins/site-policy-service';

/** One published plugin's public detail, proxied through the local server. */
export default defineEventHandler(async (event) => {
    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const pluginId = getRouterParam(event, 'pluginId') ?? '';
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid plugin id' });
    }
    try {
        const policy = await approvedSiteRelease(pluginId);
        if (!policy) throw createError({ statusCode: 404, statusMessage: 'This plugin is not approved for this site.' });
        const entry = await readCatalogEntry(pluginId) as Record<string, unknown> | null;
        if (!entry) throw createError({ statusCode: 404, statusMessage: 'This plugin is unavailable.' });
        const releases = Array.isArray(entry.releases)
            ? entry.releases.filter((release) => release && typeof release === 'object' &&
                (release as { version?: unknown }).version === policy.approvedRelease.version)
            : [];
        if (releases.length !== 1) throw createError({ statusCode: 404, statusMessage: 'The approved release is unavailable.' });
        return { configured: true, entry: { ...entry, releases, latestRelease: releases[0] } };
    } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        throw createError({
            statusCode: 503,
            statusMessage: 'The approved release could not be verified right now.',
        });
    }
});
