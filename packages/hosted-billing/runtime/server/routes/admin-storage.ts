import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireSupportAdmin, requireTargetId } from '~~/server/admin/customers';
import { useAccountQuota, useBillingService } from '../runtime';

function positive(value: unknown): number | undefined {
    const number = typeof value === 'string' && value ? Number(value) : typeof value === 'number' ? value : NaN;
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/**
 * GET /api/admin/hosted-billing/storage — deployment logical accounting and the largest accounts.
 * GET /api/admin/hosted-billing/accounts/:id/storage — one-snapshot account breakdown plus an
 * optional hypothetical-upload explanation (`workspaceId`, `sizeBytes`, `hash`). Never scans storage.
 */
export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    const quota = useAccountQuota();
    const service = useBillingService();
    const workspaceCapBytes = positive((useRuntimeConfig(event).storage as { workspaceQuotaBytes?: unknown } | undefined)?.workspaceQuotaBytes);
    const id = getRouterParam(event, 'id');
    if (!id) {
        try {
            const summary = quota.deploymentSummary();
            const charged = [...quota.chargedByOwner()].sort((a, b) => b[1] - a[1]).slice(0, 50);
            return {
                summary, workspaceCapBytes: workspaceCapBytes ?? null, settings: service.store.settings(),
                largest: charged.map(([userId, chargedBytes]) => ({ userId, chargedBytes, access: service.summarize(userId).access })),
            };
        } catch { throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable; usage is unknown.' }); }
    }
    const userId = requireTargetId(id);
    const query = getQuery(event);
    let breakdown;
    try { breakdown = quota.breakdown(userId); }
    catch { throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable; usage is unknown.' }); }
    const workspaceId = typeof query.workspaceId === 'string' && query.workspaceId ? requireTargetId(query.workspaceId) : null;
    if (workspaceId && !breakdown.workspaces.some(workspace => workspace.workspaceId === workspaceId)) throw createError({ statusCode: 400, statusMessage: 'Choose a workspace owned by this account.' });
    const hash = typeof query.hash === 'string' && /^[a-f0-9]{64}$/i.test(query.hash) ? query.hash : undefined;
    return {
        breakdown, workspaceCapBytes: workspaceCapBytes ?? null,
        explanation: workspaceId ? quota.explain(userId, { workspaceId, sizeBytes: positive(query.sizeBytes), hash, workspaceCapBytes }) : null,
    };
});
