import { randomUUID } from 'node:crypto';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requireSignupInviteStore } from '../../../admin/signup-invites';
import { createSignupInviteCode, hashSignupInviteCode } from '../../../auth/invite-token';

const Body = z.object({
    email: z.string().trim().email().max(320),
    expiresInSeconds: z.number().int().min(60).max(30 * 86400).default(72 * 3600),
}).strict();

export default defineEventHandler(async event => {
    const { store, context, config } = await requireSignupInviteStore(event, true);
    const body = Body.safeParse(await readBody(event));
    if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    const secret = config.auth.invite.tokenSecret;
    if (!secret) throw createError({ statusCode: 503, statusMessage: 'Invite token secret not configured' });
    if (!store.findSignupInviteByTokenHash) throw createError({ statusCode: 503, statusMessage: 'Selected auth store does not support short invitation codes.' });
    const id = randomUUID();
    const email = body.data.email.toLowerCase();
    const exp = Math.floor(Date.now() / 1000) + body.data.expiresInSeconds;
    const token = createSignupInviteCode();
    if (context.principal.kind !== 'super_admin') throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    await store.createSignupInvite!({ id, email, token_hash: hashSignupInviteCode(token, secret), expires_at: exp * 1000, created_by_admin: context.principal.username });
    return { ok: true, invite: { id, email, expires_at: exp * 1000, token, inviteUrl: `/?invite=${encodeURIComponent(token)}` } };
});
