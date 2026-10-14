import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requireSignupInviteStore } from '../../../admin/signup-invites';

const Body = z.object({ id: z.string().min(1).max(128) }).strict();
export default defineEventHandler(async event => {
    const { store } = await requireSignupInviteStore(event, true);
    const body = Body.safeParse(await readBody(event));
    if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    const result = await store.revokeSignupInvite!(body.data);
    if (!result.ok) throw createError({ statusCode: result.reason === 'not_found' ? 404 : 409, statusMessage: 'Invitation is no longer pending' });
    return result;
});
