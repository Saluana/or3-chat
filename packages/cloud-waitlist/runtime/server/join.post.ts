import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireSameOriginMutation } from '~~/server/utils/security/mutation-guard';
import { readLimitedJsonBody } from '~~/server/utils/security/limited-json-body';
import { getClientIp } from '~~/server/admin/auth/rate-limit';
import { createSlidingWindowRateLimiter } from '~~/server/utils/rate-limit/sliding-window';
import { enforceRateLimit } from '~~/server/utils/rate-limit/enforce';
import { joinWaitlist } from './store';

const input = z.object({ email: z.string().trim().max(254).email().transform(email => email.toLowerCase()) }).strict();
const limiter = createSlidingWindowRateLimiter({ maxEntries: 10_000, entryTtlMs: 60 * 60_000 });

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    requireSameOriginMutation(event, { intentHeader: 'x-or3-waitlist-intent', intentValue: 'join', requireJson: true });
    enforceRateLimit(event, limiter.checkAndRecord(getClientIp(event), { windowMs: 60 * 60_000, maxRequests: 10 }));
    const parsed = input.safeParse(await readLimitedJsonBody(event, 2048));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid email address is required' });
    if (!joinWaitlist(parsed.data.email)) throw createError({ statusCode: 409, statusMessage: 'Waitlist is closed' });
    // New and duplicate submissions receive the same response; never disclose membership.
    return { ok: true };
});
