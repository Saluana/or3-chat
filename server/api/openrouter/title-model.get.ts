import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { readTitleModel } from '../../utils/titles/generate';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404 });
    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.read', session.workspace ? { kind: 'workspace', id: session.workspace.id } : undefined);
    if (!session.workspace?.id) throw createError({ statusCode: 403 });
    return { model: await readTitleModel(event, session.workspace.id) };
});
