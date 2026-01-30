import { defineEventHandler, getQuery, createError } from 'h3';
import { createHash } from 'crypto';
import { requireAdminApiContext } from '../../admin/api';
import { getWorkspaceAccessStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

const CACHE_TTL = 30000; // 30 seconds
const cache = new Map<string, { data: any; timestamp: number }>();

/**
 * GET /api/admin/workspaces
 *
 * List all workspaces with search and pagination.
 * Supports:
 * - search: filter by workspace name
 * - includeDeleted: show soft-deleted workspaces
 * - page: page number (default: 1)
 * - perPage: items per page (default: 20)
 *
 * Workspace list is cached for 30 seconds to reduce database load.
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

    // Get query parameters
    const query = getQuery(event);
    const search = query.search?.toString();
    const includeDeleted = query.includeDeleted === 'true';
    const page = Math.max(1, parseInt(query.page?.toString() || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(query.perPage?.toString() || '20', 10)));

    // Generate cache key from query params
    const cacheKey = createHash('md5')
        .update(JSON.stringify({ search, includeDeleted, page, perPage }))
        .digest('hex');

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // List workspaces
    const result = await store.listWorkspaces({
        search,
        includeDeleted,
        page,
        perPage,
    });

    // Cache result
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Clean up old cache entries (simple cleanup: remove entries older than TTL * 2)
    const cutoff = Date.now() - (CACHE_TTL * 2);
    for (const [key, value] of cache.entries()) {
        if (value.timestamp < cutoff) {
            cache.delete(key);
        }
    }

    return result;
});
