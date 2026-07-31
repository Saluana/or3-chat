/**
 * @module server/api/admin/admin-users.get
 *
 * Purpose:
 * Lists users with administrative privileges.
 */
import { defineEventHandler, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getAdminUserStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

/**
 * GET /api/admin/admin-users
 *
 * Purpose:
 * Retrieves a list of all users who have deployment-level admin access.
 *
 * Security:
 * - Gated by `requireAdminApiContext`
 * - Requires admin feature flag enabled
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

    // Get admin user store
    const store = getAdminUserStore(event);

    // List admins
    const admins = await store.listAdmins();

    return { admins };
});
