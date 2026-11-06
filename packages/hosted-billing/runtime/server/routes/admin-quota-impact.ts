import { createError, defineEventHandler, getQuery } from 'h3';
import { requireSupportAdmin } from '~~/server/admin/customers';
import { useAccountQuota, useBillingService } from '../runtime';
import type { BillingAccount } from '../store';
import { evaluateAccess } from '../entitlement';

/**
 * GET /api/admin/hosted-billing/quota-impact?trialStorageGb=&paidStorageGb=
 * Advisory preview bound to the current settings revision. Saving still
 * re-checks the revision, and admission always checks live usage.
 */
export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    const query = getQuery(event);
    const proposed = { trialStorageGb: Number(query.trialStorageGb), paidStorageGb: Number(query.paidStorageGb) };
    if (!Object.values(proposed).every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000)) {
        throw createError({ statusCode: 400, statusMessage: 'Enter whole GB limits between 1 and 1,000,000.' });
    }
    const service = useBillingService();
    const current = service.store.settings();
    const currentOffer = service.store.currentOffer();
    let charged: Map<string, number>;
    try { charged = useAccountQuota().chargedByOwner(); }
    catch { throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable; impact is unknown.' }); }
    const now = Date.now();
    const result = { paid: { accounts: 0, over: 0, newlyOver: 0 }, trial: { accounts: 0, over: 0, newlyOver: 0 } };
    const examples: Array<{ userId: string; cohort: 'paid' | 'trial'; chargedBytes: number; currentLimitBytes: number; proposedLimitBytes: number }> = [];
    const accounts = service.store.db.prepare('SELECT * FROM billing_accounts').iterate() as Iterable<BillingAccount>;
    for (const account of accounts) {
        const support = service.store.support(account.user_id);
        // Access source does not depend on the allowance. Only current-offer
        // cohorts are included below, so their limits use the current settings.
        const before = evaluateAccess(account, current, now, support).access;
        const cohort = before.source === 'paid' || before.source === 'renewal_grace' ? 'paid' : before.source === 'trial' || before.source === 'support_trial' ? 'trial' : null;
        if (!cohort) continue;
        if ((cohort === 'paid' ? account.matched_offer_id : account.trial_offer_id) &&
            (cohort === 'paid' ? account.matched_offer_id : account.trial_offer_id) !== currentOffer?.id) continue;
        const after = evaluateAccess(account, { ...current, ...proposed }, now, support).access;
        const bytes = charged.get(account.user_id) ?? 0;
        result[cohort].accounts++;
        if (bytes > after.nominalStorageLimitBytes) {
            result[cohort].over++;
            if (bytes <= before.nominalStorageLimitBytes) {
                result[cohort].newlyOver++;
                if (examples.length < 20) examples.push({ userId: account.user_id, cohort, chargedBytes: bytes, currentLimitBytes: before.nominalStorageLimitBytes, proposedLimitBytes: after.nominalStorageLimitBytes });
            }
        }
    }
    return { revision: current.revision, measuredAt: now, proposed, impact: result, examples };
});
