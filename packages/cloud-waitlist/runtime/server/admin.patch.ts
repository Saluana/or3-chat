import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '~~/server/admin/api';
import { enforceGenericAdminRateLimit } from '~~/server/admin/auth/rate-limit';
import { readLimitedJsonBody } from '~~/server/utils/security/limited-json-body';
import { setWaitlistEnabled } from './store';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    enforceGenericAdminRateLimit(event, 'cloud-waitlist-write');
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(await readLimitedJsonBody(event, 256));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Expected an enabled boolean' });
    setWaitlistEnabled(parsed.data.enabled);
    return { enabled: parsed.data.enabled };
});
