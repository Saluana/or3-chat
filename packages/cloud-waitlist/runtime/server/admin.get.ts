import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '~~/server/admin/api';
import { enforceGenericAdminRateLimit } from '~~/server/admin/auth/rate-limit';
import { listWaitlist } from './store';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    await requireAdminApiContext(event, { superAdminOnly: true });
    enforceGenericAdminRateLimit(event, 'cloud-waitlist-read');
    const page = z.coerce.number().int().min(1).max(1_000_000).safeParse(getQuery(event).page ?? 1);
    if (!page.success) throw createError({ statusCode: 400, statusMessage: 'Invalid page' });
    return listWaitlist(page.data);
});
