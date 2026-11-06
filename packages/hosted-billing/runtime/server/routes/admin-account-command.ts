import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireSupportAdmin, requireTargetId } from '~~/server/admin/customers';
import { readLimitedJsonBody } from '~~/server/utils/security/limited-json-body';
import { getRateLimitProvider } from '~~/server/utils/rate-limit/store';
import { enforceRateLimit } from '~~/server/utils/rate-limit/enforce';
import { useBillingService } from '../runtime';
import { BillingBusyError, BillingCommandError } from '../store';

const OperationId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const Refresh = z.object({ operationId: OperationId }).strict();
const Review = z.object({
    operationId: OperationId, reason: z.string().max(500), expectedRevision: z.number().int().min(0),
    reviewIds: z.array(z.string().max(100)).max(50),
}).strict();

const Time = z.number().int().positive();
const Support = z.object({
    operationId: OperationId, reason: z.string().max(500), expectedRevision: z.number().int().min(0),
    command: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('grant'), expiresAt: Time, storageBytes: z.number().int().positive() }).strict(),
        z.object({ kind: z.literal('revoke_grant') }).strict(),
        z.object({ kind: z.literal('extend_trial'), expiresAt: Time }).strict(),
        z.object({ kind: z.literal('storage_bonus'), bytes: z.number().int().min(0), expiresAt: Time.nullable() }).strict(),
        z.object({ kind: z.enum(['pause_account', 'pause_uploads', 'pause_jobs']), expiresAt: Time.nullable() }).strict(),
        z.object({ kind: z.enum(['resume_account', 'resume_uploads', 'resume_jobs']) }).strict(),
    ]),
}).strict();

/** POST /api/admin/hosted-billing/accounts/:id/(refresh|review|support) — explicit, audited support commands. */
export default defineEventHandler(async event => {
    const actor = await requireSupportAdmin(event, { mutation: true });
    const userId = requireTargetId(getRouterParam(event, 'id'));
    const command = getRouterParam(event, 'command');
    enforceRateLimit(event, await getRateLimitProvider().checkAndRecord(`admin-billing:${actor}`, { windowMs: 60_000, maxRequests: 30 }));
    const body = await readLimitedJsonBody(event);
    const service = useBillingService();
    try {
        if (command === 'refresh') {
            const input = Refresh.safeParse(body);
            if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid refresh request' });
            return await service.adminRefresh(userId, { ...input.data, actor });
        }
        if (command === 'review') {
            const input = Review.safeParse(body);
            if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid review decision' });
            return await service.resolveReviews(userId, { ...input.data, actor });
        }
        if (command === 'support') {
            const input = Support.safeParse(body);
            if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid support command' });
            return await service.supportCommand(userId, { ...input.data, actor });
        }
        throw createError({ statusCode: 404, statusMessage: 'Unknown command' });
    } catch (error) {
        if (error instanceof BillingCommandError) throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
        if (error instanceof BillingBusyError) {
            setResponseHeader(event, 'Retry-After', 2);
            throw createError({ statusCode: 503, statusMessage: 'This account is updating. Try again shortly.', data: { code: 'account_busy' } });
        }
        throw error;
    }
});
