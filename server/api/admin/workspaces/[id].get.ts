/**
 * @module server/api/admin/workspaces/[id].get
 *
 * Purpose:
 * Retrieves detailed information about a specific workspace from the super admin perspective.
 */
import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';
import { checkGenericRateLimit, getClientIp } from '../../../admin/auth/rate-limit';

/**
 * GET /api/admin/workspaces/:id
 *
 * Purpose:
 * Fetch full workspace metadata + member list.
 *
 * Behavior:
 * - Rate limited.
 * - Requires super admin context (via `requireAdminApiContext` and typically `super_admin` role implied by route).
 * - Returns 404 if not found.
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
    await requireAdminApiContext(event);

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

    // Get workspace
    const workspace = await store.getWorkspace({ workspaceId });

    if (!workspace) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Workspace not found',
        });
    }

    // Get members
    const members = await store.listMembers({ workspaceId });

    return {
        ...workspace,
        members,
    };
});
