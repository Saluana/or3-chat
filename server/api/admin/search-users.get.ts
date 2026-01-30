import { defineEventHandler, getQuery, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getAdminUserStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

/**
 * GET /api/admin/search-users
 *
 * Search users by email or display name.
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

    const query = getQuery(event);
    const search = query.q?.toString();
    const limit = Math.min(50, Math.max(1, parseInt(query.limit?.toString() || '20', 10)));

    if (!search || !search.trim()) {
        return [];
    }

    // Get admin user store
    const store = getAdminUserStore(event);

    // Search users
    const results = await store.searchUsers({
        query: search.trim(),
        limit,
    });

    return results;
});
