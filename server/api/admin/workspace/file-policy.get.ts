import { defineEventHandler, getQuery } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';
import { setNoCacheHeaders } from '../../../utils/headers';
import { readFilePolicy } from '../../../utils/storage/file-policy';

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    const context = await requireAdminApiContext(event, { ownerOnly: true, allowWorkspaceAdmin: true });
    const query = getQuery(event);
    const workspaceId = resolveAdminWorkspaceTarget(context, typeof query.workspaceId === 'string' ? query.workspaceId : undefined);
    return { workspaceId, policy: await readFilePolicy(event, workspaceId) };
});
