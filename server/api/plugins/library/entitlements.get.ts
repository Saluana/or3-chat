/**
 * @module server/api/plugins/library/entitlements.get
 *
 * The linked account's purchased releases, for the local Library view (task
 * 10.1). This is a read-only listing proxied through the server-held credential:
 * the browser never sees the Library token, and an unlinked user gets an empty
 * listing without a marketplace request.
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
    return await service.entitlements(userId);
});
