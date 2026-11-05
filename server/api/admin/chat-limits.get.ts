import { defineEventHandler, getQuery } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { isSuperAdmin } from '../../admin/context';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { readSiteSettings } from '../../admin/config/site-settings';
import { readChatLimits } from '../../utils/chat/chat-limits';
import { setNoCacheHeaders } from '../../utils/headers';

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    const context = await requireAdminApiContext(event, { ownerOnly: true, allowWorkspaceAdmin: true });
    const query = getQuery(event);
    const workspaceId = resolveAdminWorkspaceTarget(context, typeof query.workspaceId === 'string' ? query.workspaceId : undefined);
    return { workspaceId, ...await readChatLimits(event, workspaceId), canEditInstance: isSuperAdmin(context),
        revision: isSuperAdmin(context) ? (await readSiteSettings()).revision : undefined };
});
