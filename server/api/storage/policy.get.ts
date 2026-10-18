import { createError, defineEventHandler, getQuery } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { requireStorageWorkspaceAccess } from '../../utils/storage/workspace-access';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { setNoCacheHeaders } from '../../utils/headers';
import { readFilePolicy } from '../../utils/storage/file-policy';

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    if (!isSsrAuthEnabled(event) || !isStorageEnabled(event)) throw createError({ statusCode: 404 });
    const workspaceId = getQuery(event).workspaceId;
    if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 256) throw createError({ statusCode: 400 });
    const session = await resolveSessionContext(event);
    await requireStorageWorkspaceAccess(event, session, workspaceId);
    const policy = await readFilePolicy(event, workspaceId);
    await requireStorageWorkspaceAccess(event, session, workspaceId);
    return policy;
});
