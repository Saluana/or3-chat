import { createError, defineEventHandler, getRouterParam } from 'h3';
import { inspect, requireSupportAdmin, requireTargetId } from '../../../admin/customers';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';

/**
 * GET /api/admin/customers/:id — canonical identity plus independently failing
 * workspace/membership section. Workspace content is never read.
 */
export default defineEventHandler(async (event) => {
    await requireSupportAdmin(event);
    const userId = requireTargetId(getRouterParam(event, 'id'));
    const store = getWorkspaceAccessStore(event);
    if (!store.getCustomersByIds) throw createError({ statusCode: 501, statusMessage: 'Customer inspection is unavailable for this sync provider', data: { code: 'provider_capability_unavailable' } });
    let customer;
    try { [customer] = await store.getCustomersByIds({ userIds: [userId] }); }
    catch { throw createError({ statusCode: 503, statusMessage: 'Customer directory unavailable' }); }
    if (!customer) throw createError({ statusCode: 404, statusMessage: 'Account not found' });
    const workspaces = await inspect(store.getCustomerWorkspaces ? () => store.getCustomerWorkspaces!({ userId }) : null);
    const sync = await inspect(store.getCustomerSyncObservations ? () => store.getCustomerSyncObservations!({ userId }) : null);
    return { customer, workspaces, sync };
});
