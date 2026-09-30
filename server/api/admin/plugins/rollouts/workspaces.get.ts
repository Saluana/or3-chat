import { defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';

/** Paginated workspace picker; the browser never renders the full deployment. */
export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const query = getQuery(event);
    const requestedPage = Number(query.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 10_000
        ? requestedPage : 1;
    const search = typeof query.search === 'string' ? query.search.trim().slice(0, 80) : '';
    return getWorkspaceAccessStore(event).listWorkspaces({ page, perPage: 25, search, includeDeleted: false });
});
