import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readCatalogEntry } from '../../../utils/plugins/marketplace/service';

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
        const entry = await readCatalogEntry(pluginId);
        return { configured: entry !== null, entry };
    } catch (error) {
        throw createError({
            statusCode: 404,
            statusMessage:
                error instanceof Error ? error.message : 'That plugin is not published.',
        });
    }
});
