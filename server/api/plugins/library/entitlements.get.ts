/**
 * @module server/api/plugins/library/entitlements.get
 *
 * The linked account's purchased releases, for the local Library view (task
 * 10.1). This is a read-only listing proxied through the server-held credential:
 * the browser never sees the Library token, and an unlinked user gets an empty
 * listing without a marketplace request.
 */
import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { libraryLinkServiceFor } from '../../../admin/library/route-support';

const Query = z.object({
    acquiredCursor: z.string().min(1).max(200).optional(),
    pluginCoverageCursor: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
        .optional(),
    releaseId: z
        .string()
        .regex(/^rel_[A-Za-z0-9._:-]{1,100}$/)
        .optional(),
});

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

    const query = Query.safeParse(getQuery(event));
    if (!query.success)
        throw createError({ statusCode: 400, statusMessage: 'Invalid Library query' });
    const { service } = await libraryLinkServiceFor(event);
    return await service.entitlements(userId, query.data);
});
