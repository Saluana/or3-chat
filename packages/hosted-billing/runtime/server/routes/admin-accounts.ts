import { createError, defineEventHandler, getQuery } from 'h3';
import { requireSupportAdmin } from '~~/server/admin/customers';
import { getWorkspaceAccessStore } from '~~/server/admin/stores/registry';
import { useBillingService } from '../runtime';
import type { AccountFilter } from '../store';

const FILTERS = new Set<AccountFilter>(['paid', 'trial', 'attention']);

/**
 * GET /api/admin/hosted-billing/accounts
 * - `ids=a,b` (≤50): billing summaries for a canonical directory page.
 * - `filter=paid|trial|attention`: server-side population filter, keyset-paged,
 *   enriched in one canonical batch. Missing canonical identities are counted, never invented.
 */
export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    const service = useBillingService();
    const query = getQuery(event);
    if (query.counts === '1') return { counts: service.store.filterCounts(), population: 'billing_accounts' as const };
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw createError({ statusCode: 400, statusMessage: 'Pages hold at most 50 rows.' });
    if (typeof query.ids === 'string') {
        const ids = query.ids.split(',').filter(Boolean);
        if (ids.length > 50 || ids.some(id => !/^[A-Za-z0-9_.:@-]{1,200}$/.test(id))) throw createError({ statusCode: 400, statusMessage: 'Invalid account IDs' });
        return { items: ids.map(id => service.summarize(id)) };
    }
    const filter = query.filter as AccountFilter;
    const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : null;
    if (!FILTERS.has(filter) || (cursor && cursor.length > 200)) throw createError({ statusCode: 400, statusMessage: 'Choose a paid, trial or attention filter.' });
    const page = service.store.filterAccounts(filter, { cursor, limit });
    const store = getWorkspaceAccessStore(event);
    if (!store.getCustomersByIds) return { available: false, items: [], nextCursor: null, counts: service.store.filterCounts(), missingCanonical: 0 };
    const customers = new Map((await store.getCustomersByIds({ userIds: page.userIds })).map(customer => [customer.userId, customer]));
    const items = page.userIds.filter(id => customers.has(id)).map(id => ({ ...customers.get(id)!, billing: service.summarize(id) }));
    return {
        available: true, items, nextCursor: page.nextCursor,
        counts: service.store.filterCounts(), population: 'billing_accounts' as const,
        missingCanonical: page.userIds.length - items.length,
    };
});
