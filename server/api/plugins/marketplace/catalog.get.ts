import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readCatalogPage } from '../../../utils/plugins/marketplace/service';

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
        const catalog = await readCatalogPage(url.searchParams);
        return { configured: catalog !== null, catalog };
    } catch (error) {
        return {
            configured: true,
            catalog: null,
            notice:
                error instanceof Error
                    ? error.message
                    : 'The marketplace could not be reached.',
        };
    }
});
