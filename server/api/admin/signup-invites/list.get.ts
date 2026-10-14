import { createError, defineEventHandler, getQuery } from 'h3';
import { z } from 'zod';
import { requireSignupInviteStore } from '../../../admin/signup-invites';

const Query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(2048).optional() }).strict();
export default defineEventHandler(async event => {
    const { store } = await requireSignupInviteStore(event);
    const query = Query.safeParse(getQuery(event));
    if (!query.success) throw createError({ statusCode: 400, statusMessage: 'Invalid query' });
    try { return await store.listSignupInvites!(query.data); }
    catch (error) {
        if (error instanceof Error && error.message === 'Invalid invite cursor') throw createError({ statusCode: 400, statusMessage: error.message });
        throw error;
    }
});
