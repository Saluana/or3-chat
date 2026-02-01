import { defineEventHandler, getQuery, createError } from 'h3';
import { createHash } from 'crypto';
import { requireAdminApiContext } from '../../admin/api';
import { getWorkspaceAccessStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';
import { getAdminFromCookie } from '../../admin/auth/jwt';

const CACHE_TTL = 30000; // 30 seconds
const CLEANUP_INTERVAL = 60000; // 1 minute

interface WorkspaceListResult {
    items: Array<{
        id: string;
        name: string;
        description?: string;
        createdAt: number;
        deleted: boolean;
        deletedAt?: number;
        ownerUserId?: string;
        ownerEmail?: string;
        memberCount: number;
    }>;
    total: number;
}

const cache = new Map<string, { data: WorkspaceListResult; timestamp: number }>();

// Periodic cleanup to prevent unbounded cache growth
setInterval(() => {
    const cutoff = Date.now() - (CACHE_TTL * 2);
    for (const [key, value] of cache.entries()) {
        if (value.timestamp < cutoff) {
            cache.delete(key);
        }
    }
}, CLEANUP_INTERVAL);

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
 * Workspace list is cached for 30 seconds per admin to reduce database load.
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

    // Get admin username for cache scoping
    const adminClaims = await getAdminFromCookie(event);
    const adminUsername = adminClaims?.username || 'unknown';

    // Get query parameters
    const query = getQuery(event);
    const search = query.search?.toString();
    const includeDeleted = query.includeDeleted === 'true';
    const page = Math.max(1, parseInt(query.page?.toString() || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(query.perPage?.toString() || '20', 10)));

    // Generate cache key scoped to admin and query params
    const cacheKey = createHash('md5')
        .update(JSON.stringify({ admin: adminUsername, search, includeDeleted, page, perPage }))
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

    return result;
});
