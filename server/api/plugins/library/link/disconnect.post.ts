/**
 * @module server/api/plugins/library/link/disconnect.post
 *
 * Disconnect this server from the signed-in user's marketplace Library. The
 * local credential stops being used immediately; central revocation is
 * attempted and retried by the status route if the marketplace is unreachable.
 */
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { requireCan, requireSession } from '../../../../auth/can';
import { resolveSessionContext } from '../../../../auth/session';
import { libraryLinkServiceFor } from '../../../../admin/library/route-support';

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

    const { service } = libraryLinkServiceFor(event);
    const result = await service.disconnect(userId);
    if (!result.ok) return { error: result.failure };
    return result.value;
});
