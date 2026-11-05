import { createError, defineEventHandler, getQuery } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { readChatLimits } from '../../utils/chat/chat-limits';
import { setNoCacheHeaders } from '../../utils/headers';

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404 });
    const workspaceId = getQuery(event).workspaceId;
    const session = await resolveSessionContext(event);
    if (typeof workspaceId !== 'string' || workspaceId !== session.workspace?.id) throw createError({ statusCode: 403 });
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });
    return (await readChatLimits(event, workspaceId)).effective;
});
