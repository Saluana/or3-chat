import { createError, defineEventHandler, getQuery } from 'h3';
import { requireSupportAdmin } from '~~/server/admin/customers';
import { useBillingService } from '../runtime';

/** GET /api/admin/hosted-billing/activity — audited billing decisions (atomic with their state changes). */
export default defineEventHandler(async event => {
    await requireSupportAdmin(event);
    const query = getQuery(event);
    const text = (value: unknown, max: number) => typeof value === 'string' && value && value.length <= max ? value : undefined;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw createError({ statusCode: 400, statusMessage: 'Pages hold at most 100 records.' });
    let cursor: { at: number; id: string } | null = null;
    if (typeof query.cursor === 'string' && query.cursor) {
        const [at, id] = query.cursor.split('|');
        if (!Number.isSafeInteger(Number(at)) || !id || id.length > 100) throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' });
        cursor = { at: Number(at), id };
    }
    const number = (value: unknown) => {
        if (value === undefined || value === '') return undefined;
        if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid activity time filter.' });
        }
        return Number(value);
    };
    const store = useBillingService().store;
    const items = store.recentActions({ limit, cursor, actor: text(query.actor, 200), kind: text(query.action, 80), userId: text(query.targetId, 200), since: number(query.since), until: number(query.until) });
    const last = items.at(-1);
    const first = store.db.prepare('SELECT MIN(created_at) AS at FROM billing_admin_actions').get() as { at: number | null };
    return {
        items: items.map(item => ({
            operationId: item.operationId, source: 'billing', at: item.createdAt, actor: item.actor, action: item.kind,
            target: { kind: 'account', id: item.userId }, reason: item.reason, before: item.before, after: item.after,
            outcome: item.outcome === 'failed' ? 'failed' : 'completed', code: item.code,
        })),
        nextCursor: items.length === limit && last ? `${last.createdAt}|${last.operationId}` : null,
        coverageStart: first.at,
    };
});
