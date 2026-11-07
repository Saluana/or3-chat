import { defineEventHandler, getRouterParam } from 'h3';
import { requireSupportAdmin, requireTargetId } from '~~/server/admin/customers';
import { useBillingService } from '../runtime';

/** GET /api/admin/hosted-billing/accounts/:id — payment, access and support projection. No Stripe calls, no writes. */
export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    const userId = requireTargetId(getRouterParam(event, 'id'));
    const service = useBillingService();
    const inspection = service.inspectAccount(userId);
    const used = inspection.account ? service.storageUsedBytes(userId) : 0;
    return {
        ...inspection,
        storage: used === null ? { status: 'error' as const, code: 'accounting_unavailable' } : { status: 'available' as const, value: { usedBytes: used }, observedAt: Date.now() },
        environment: service.config.secretKey.includes('_live_') ? 'live' : 'test',
    };
});
