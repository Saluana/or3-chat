import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '~~/server/admin/api';
import { readLimitedJsonBody } from '~~/server/utils/security/limited-json-body';
import { useBillingService } from '../runtime';

const Settings = z.object({
    trialStorageGb: z.number().int().min(1).max(1_000_000),
    paidStorageGb: z.number().int().min(1).max(1_000_000),
    revision: z.number().int().positive(),
}).strict();

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(event.method)) throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: event.method === 'POST' });
    const store = useBillingService().store;
    if (event.method === 'POST') {
        const body = Settings.safeParse(await readLimitedJsonBody(event));
        if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Enter whole GB limits between 1 and 1,000,000.' });
        if (!store.saveSettings(body.data)) throw createError({ statusCode: 409, statusMessage: 'Settings changed. Reload before saving again.' });
    }
    return store.settings();
});
