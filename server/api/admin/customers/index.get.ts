import { createError, defineEventHandler, getQuery } from 'h3';
import { requireSupportAdmin } from '../../../admin/customers';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';

/** GET /api/admin/customers — bounded canonical directory (50 per page, 200-character search). */
export default defineEventHandler(async (event) => {
    await requireSupportAdmin(event);
    const query = getQuery(event);
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : null;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (q.length > 200 || (cursor && cursor.length > 500) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        throw createError({ statusCode: 400, statusMessage: 'Search must be at most 200 characters and pages at most 50 rows.' });
    }
    const store = getWorkspaceAccessStore(event);
    if (!store.listCustomers) return { available: false, items: [], nextCursor: null };
    try {
        return { available: true, ...(await store.listCustomers({ query: q || undefined, cursor, limit })) };
    } catch {
        throw createError({ statusCode: cursor ? 400 : 503, statusMessage: cursor ? 'Invalid page cursor' : 'Customer directory unavailable' });
    }
});
