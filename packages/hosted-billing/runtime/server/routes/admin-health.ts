import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { requireSupportAdmin } from '~~/server/admin/customers';
import { getRateLimitProvider } from '~~/server/utils/rate-limit/store';
import { enforceRateLimit } from '~~/server/utils/rate-limit/enforce';
import { useBillingService } from '../runtime';

/**
 * GET  /api/admin/hosted-billing/health — local projection only: no Stripe call, no global reconciliation.
 * POST /api/admin/hosted-billing/health — explicit price check against Stripe, recorded with its time.
 */
export default defineEventHandler(async event => {
    const actor = await requireSupportAdmin(event, { mutation: event.method === 'POST' });
    const service = useBillingService();
    const db = service.store.db;
    if (event.method === 'POST') {
        enforceRateLimit(event, await getRateLimitProvider().checkAndRecord(`admin-billing-price:${actor}`, { windowMs: 60_000, maxRequests: 5 }));
        let result = 'ok';
        let code: string | null = null;
        try { await service.validatePrice(); }
        catch { result = 'failed'; code = 'price_mismatch_or_unreachable'; }
        db.prepare("INSERT INTO billing_health (name, checked_at, result, code) VALUES ('price', ?, ?, ?) ON CONFLICT(name) DO UPDATE SET checked_at = excluded.checked_at, result = excluded.result, code = excluded.code")
            .run(Date.now(), result, code);
    } else if (event.method !== 'GET') {
        setResponseHeader(event, 'Allow', 'GET, POST');
        throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
    }
    const settings = service.store.settings();
    const currentOffer = service.store.currentOffer()!;
    const price = db.prepare("SELECT checked_at AS checkedAt, result, code FROM billing_health WHERE name = 'price'").get() ?? null;
    const reconciliation = db.prepare(`SELECT MAX(last_reconciled_at) AS lastAt,
        SUM(CASE WHEN last_reconcile_outcome = 'failed' THEN 1 ELSE 0 END) AS failedAccounts FROM billing_accounts`).get() as { lastAt: number | null; failedAccounts: number | null };
    const reviews = db.prepare(`SELECT review.id, review.user_id AS userId, review.kind, review.opened_at AS openedAt, account.subscription_status AS subscriptionStatus, account.paid_until AS paidUntil
        FROM billing_reviews AS review JOIN billing_accounts AS account ON account.user_id = review.user_id
        WHERE review.resolved_at IS NULL ORDER BY review.opened_at LIMIT 50`).all();
    const openReviewAccounts = (db.prepare('SELECT COUNT(*) AS n FROM billing_accounts WHERE review_required = 1').get() as { n: number }).n;
    const window = Date.now() - 30 * 86_400_000;
    const failedOutcomes = (db.prepare("SELECT COUNT(*) AS n FROM billing_processing_outcomes WHERE result = 'failed' AND last_attempt_at >= ?").get(window) as { n: number }).n;
    return {
        environment: service.config.secretKey.includes('_live_') ? 'live' : 'test',
        offer: { amount: currentOffer.amountCents / 100, currency: 'USD', interval: 'year', trialDays: currentOffer.trialDays, paidStorageGb: settings.paidStorageGb, trialStorageGb: settings.trialStorageGb, editable: false },
        priceCheck: price,
        reconciliation: { lastAt: reconciliation.lastAt || null, failedAccounts: reconciliation.failedAccounts ?? 0 },
        counts: service.store.filterCounts(),
        reviews, openReviewAccounts,
        outcomes: service.store.outcomes({ limit: 50 }),
        failedOutcomes, outcomeWindowDays: 30,
    };
});
