/**
 * @module server/api/admin/search-users.get
 *
 * Purpose:
 * Provides user search capabilities for admin dashboards.
 *
 * Responsibilities:
 * - Search by partial name or email (provider dependent)
 * - Enforce result limits
 *
 * Security:
 * - Gated by `requireAdminApiContext`
 */
import { defineEventHandler, getQuery, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getAdminUserStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

// Search pagination limits
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const MIN_SEARCH_LIMIT = 1;

/**
 * GET /api/admin/search-users
 *
 * Purpose:
 * Finds users matching a text query string.
 *
 * Behavior:
 * - Wraps `AdminUserStore.searchUsers()`
 * - Caps limits to `MAX_SEARCH_LIMIT` (50) to prevent oversized payloads
 * - Returns empty array for empty/whitespace queries
 *
 * Query Params:
 * - `q`: Search term (string)
 * - `limit`: Max results (default 20, max 50)
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
    const limit = Math.min(
        MAX_SEARCH_LIMIT,
        Math.max(MIN_SEARCH_LIMIT, parseInt(query.limit?.toString() || String(DEFAULT_SEARCH_LIMIT), 10))
    );

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
