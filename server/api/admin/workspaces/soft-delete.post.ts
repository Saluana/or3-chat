/**
 * @module server/api/admin/workspaces/soft-delete.post
 *
 * Purpose:
 * Marks a workspace as deleted without immediately purging data.
 */
import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';
import { checkGenericRateLimit, getClientIp } from '../../../admin/auth/rate-limit';

/**
 * POST /api/admin/workspaces/:id/soft-delete
 *
 * Purpose:
 * Archive a workspace.
 *
 * Behavior:
 * - Sets `deletedAt` timestamp.
 * - Emits `admin.workspace:action:deleted` hook.
 * - Rate limited.
 *
 * Security:
 * - Captures actor ID for the audit hook.
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Rate limit check
    const clientIp = getClientIp(event);
    const rateLimit = checkGenericRateLimit(clientIp, 'admin-api');
    
    if (!rateLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many requests',
        });
    }

    // Require admin context
    const adminCtx = await requireAdminApiContext(event);

    // Get workspace ID
    const workspaceId = getRouterParam(event, 'id');
    if (!workspaceId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace ID is required',
        });
    }

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // Soft delete workspace
    await store.softDeleteWorkspace({
        workspaceId,
        deletedAt: Date.now(),
    });

    const actorId = adminCtx.principal.kind === 'super_admin' 
        ? adminCtx.principal.username 
        : adminCtx.principal.userId;

    await event.context.adminHooks?.doAction('admin.workspace:action:deleted', {
        workspaceId,
        deletedBy: { kind: adminCtx.principal.kind, id: actorId },
    });

    return { success: true };
});
