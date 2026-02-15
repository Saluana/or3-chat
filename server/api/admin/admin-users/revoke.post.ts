/**
 * @module server/api/admin/admin-users/revoke.post
 *
 * Purpose:
 * Removes administrative privileges from a user.
 */
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
 * Purpose:
 * Demotes an admin user back to a regular user.
 *
 * Behavior:
 * - Updates the user record in `AdminUserStore`.
 * - Does not delete the user, only strips the `is_admin` or equivalent flag/role.
 *
 * Constraints:
 * - Caller must have permission to manage admins (usually Super Admin).
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Require super admin context
    await requireAdminApiContext(event, { superAdminOnly: true });

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
