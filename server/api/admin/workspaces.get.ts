import { defineEventHandler, getQuery, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getWorkspaceAccessStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

/**
 * GET /api/admin/workspaces
 *
 * List all workspaces with search and pagination.
 * Supports:
 * - search: filter by workspace name
 * - includeDeleted: show soft-deleted workspaces
 * - page: page number (default: 1)
 * - perPage: items per page (default: 20)
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

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // List workspaces
    const result = await store.listWorkspaces({
        search,
        includeDeleted,
        page,
        perPage,
    });

    return result;
});
