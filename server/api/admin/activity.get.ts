import { createError, defineEventHandler, getQuery } from 'h3';
import { requireSupportAdmin } from '../../admin/customers';
import { readAdminActivity } from '../../admin/activity/journal';

/**
 * GET /api/admin/activity — bounded, filtered page of the private admin journal.
 * Billing decisions are read from their own audited source and merged by the page.
 */
export default defineEventHandler(async (event) => {
    await requireSupportAdmin(event);
    const query = getQuery(event);
    const text = (value: unknown, max: number) => {
        if (value === undefined || value === '') return undefined;
        if (typeof value !== 'string' || value.length > max) throw createError({ statusCode: 400, statusMessage: 'Invalid activity filter' });
        return value;
    };
    const time = (value: unknown) => {
        if (value === undefined || value === '') return undefined;
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid activity time' });
        return number;
    };
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw createError({ statusCode: 400, statusMessage: 'Pages hold at most 100 records.' });
    try {
        return await readAdminActivity({
            limit, cursor: text(query.cursor, 100), actor: text(query.actor, 200), action: text(query.action, 80),
            targetId: text(query.targetId, 200), since: time(query.since), until: time(query.until),
        });
    } catch {
        throw createError({ statusCode: 503, statusMessage: 'Administrative history is unavailable.' });
    }
});
