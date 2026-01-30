import { defineEventHandler, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getAdminUserStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

/**
 * GET /api/admin/admin-users
 *
 * List all users with deployment admin access.
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
