import { createError, defineEventHandler } from 'h3';
import { z } from 'zod';
import { requireSupportAdmin } from '../../../admin/customers';
import { PAUSE_KINDS, saveServicePause } from '../../../admin/pauses';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';
import { enforceRateLimit } from '../../../utils/rate-limit/enforce';

const Body = z.object({
    operationId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    kind: z.enum(PAUSE_KINDS),
    active: z.boolean(),
    expiresAt: z.number().int().positive().nullable(),
    reason: z.string().trim().min(1).max(500),
    expectedRevision: z.string().max(40),
}).strict();

/** POST /api/admin/system/pauses — pause or resume one kind of new work, with a reason. */
export default defineEventHandler(async (event) => {
    const actor = await requireSupportAdmin(event, { mutation: true });
    enforceRateLimit(event, await getRateLimitProvider().checkAndRecord(`admin-pauses:${actor}`, { windowMs: 60_000, maxRequests: 20 }));
    const body = Body.safeParse(await readLimitedJsonBody(event));
    if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Choose a pause, a reason of 1–500 characters and an optional future expiry.' });
    const { revision } = await saveServicePause({ ...body.data, actor });
    return { ok: true, revision };
});
