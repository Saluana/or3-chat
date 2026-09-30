/**
 * @module server/api/plugins/library/link.get
 *
 * The signed-in user's own Library link state. Polling happens here when a
 * pairing attempt is due, so the browser receives only the comparison code, the
 * verification URL and the linked account summary — never the polling secret or
 * the local credential.
 */
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { libraryLinkServiceFor } from '../../../admin/library/route-support';

export default defineEventHandler(async (event) => {
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id;
    const workspaceId = session.workspace?.id;
    if (!userId || !workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const { service } = await libraryLinkServiceFor(event);
    return await service.status(userId);
});
