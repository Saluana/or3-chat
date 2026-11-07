import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireSupportAdmin } from '~~/server/admin/customers';
import { readLimitedJsonBody } from '~~/server/utils/security/limited-json-body';
import { enforceGenericAdminRateLimit } from '~~/server/admin/auth/rate-limit';
import { useBillingService } from '../runtime';
import { BillingCommandError } from '../store';

const CreateOffer = z.object({ kind: z.literal('create_current'), priceId: z.string().regex(/^price_[A-Za-z0-9_]{1,190}$/),
    amountCents: z.number().int().min(1).max(100_000_000), paidStorageGb: z.number().int().min(1).max(1_000_000),
    trialStorageGb: z.number().int().min(1).max(1_000_000), trialDays: z.number().int().min(1).max(90) }).strict();
const Change = z.object({ operationId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), reason: z.string().trim().min(1).max(500), expectedRevision: z.number().int().positive(),
    command: z.discriminatedUnion('kind', [CreateOffer, z.object({ kind: z.literal('retire'), offerId: z.string().max(100) }).strict()]) }).strict();

/** Explicit Stripe validation; loading the accepted history remains entirely local. */
export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const actor = await requireSupportAdmin(event, { mutation: event.method === 'POST' });
    const service = useBillingService();
    const state = () => {
        const offers = service.store.offers();
        const cohorts = service.store.db.prepare(`SELECT matched_offer_id AS offerId, COUNT(*) AS accounts FROM billing_accounts WHERE matched_offer_id IS NOT NULL GROUP BY matched_offer_id`).all();
        return { ...offers, cohorts, impact: 'New checkout sessions and new trials only. Existing subscribers and trials keep their accepted terms. No subscriptions are migrated.' };
    };
    if (event.method === 'GET') return state();
    if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
    enforceGenericAdminRateLimit(event, 'billing-offers');
    const input = Change.safeParse(await readLimitedJsonBody(event));
    if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Enter a valid annual USD offer, revision and reason.' });
    try {
        if (getQuery(event).preview === 'true') {
            if (service.store.offers().revision !== input.data.expectedRevision) throw new BillingCommandError(409, 'stale_revision', 'Offers changed. Reload before previewing.');
            if (input.data.command.kind !== 'create_current') throw new BillingCommandError(400, 'invalid_command', 'Only new offers need a price validation.');
            await service.validatePrice({ ...input.data.command, currency: 'usd', interval: 'year' });
            return { ...state(), validatedAt: Date.now(), proposed: input.data.command };
        }
        await service.changeOffer({ ...input.data, actor });
        return state();
    } catch (error) {
        if (error instanceof BillingCommandError) throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
        throw createError({ statusCode: 503, statusMessage: 'The price could not be verified or the change could not be recorded. Reload before retrying.' });
    }
});
