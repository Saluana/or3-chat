import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireSupportAdmin } from '~~/server/admin/customers';
import { enforceGenericAdminRateLimit } from '~~/server/admin/auth/rate-limit';
import { BillingCommandError } from '../store';
import { readLimitedJsonBody } from '~~/server/utils/security/limited-json-body';
import { useBillingService } from '../runtime';

const Settings = z.object({
    trialStorageGb: z.number().int().min(1).max(1_000_000),
    paidStorageGb: z.number().int().min(1).max(1_000_000),
    revision: z.number().int().positive(),
    operationId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    reason: z.string().trim().min(1).max(500),
}).strict();

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(event.method)) throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
    const actor = await requireSupportAdmin(event, { mutation: event.method === 'POST' });
    const service = useBillingService();
    const store = service.store;
    if (event.method === 'POST') {
        const body = Settings.safeParse(await readLimitedJsonBody(event));
        if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Enter whole GB limits between 1 and 1,000,000, a reason and operation ID.' });
        enforceGenericAdminRateLimit(event, 'billing-allowances');
        const { operationId, reason, ...settings } = body.data;
        try { return service.changeAllowances({ operationId, actor, reason, settings }); }
        catch (error) {
            if (error instanceof BillingCommandError) throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
            throw createError({ statusCode: 503, statusMessage: 'The allowance change could not be recorded. Reload before retrying.' });
        }
    }
    return store.settings();
});
