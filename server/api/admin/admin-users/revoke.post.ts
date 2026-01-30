import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getAdminUserStore } from '../../../admin/stores/registry';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

interface RevokeAdminBody {
    userId: string;
}

/**
 * POST /api/admin/admin-users/revoke
 *
 * Revoke deployment admin access from a user.
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Require admin context
    await requireAdminApiContext(event);

    const body = await readBody<RevokeAdminBody>(event);
    const { userId } = body;

    if (!userId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'User ID is required',
        });
    }

    // Get admin user store
    const store = getAdminUserStore(event);

    // Revoke admin access
    await store.revokeAdmin({ userId });

    return { success: true };
});
