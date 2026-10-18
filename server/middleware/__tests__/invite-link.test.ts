import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { createHmac } from 'node:crypto';
import { createEvent, type H3Event } from 'h3';
import { createInviteToken, verifyInviteToken } from '../../auth/invite-token';
import { resetSyncRateLimits } from '../../utils/sync/rate-limiter';
import { getInviteTokenFromEvent, INVITE_TOKEN_COOKIE } from '../../auth/registration';

const lookup = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../auth/store/registry', () => ({ getAuthWorkspaceStore: () => ({ findSignupInviteByTokenHash: lookup }) }));

const SECRET = 'invite-link-test-secret';
const config = vi.hoisted(() => ({
    value: {} as Record<string, unknown>,
}));

vi.mock('h3', async (importOriginal) => ({
    ...await importOriginal<typeof import('h3')>(),
    defineEventHandler: (handler: unknown) => handler,
}));
vi.mock('#imports', () => ({ useRuntimeConfig: () => config.value }));

function makeEvent(url: string, options: { method?: string; forwardedProto?: string; cookie?: string } = {}): H3Event {
    const req = new IncomingMessage(new Socket());
    req.method = options.method ?? 'GET';
    req.url = url;
    req.headers = { host: 'chat.example.com' };
    if (options.forwardedProto) req.headers['x-forwarded-proto'] = options.forwardedProto;
    if (options.cookie) req.headers.cookie = options.cookie;
    return createEvent(req, new ServerResponse(req));
}

const setCookie = (event: H3Event) => [event.node.res.getHeader('set-cookie') ?? []].flat().map(String);
const token = (expSeconds: number, secret = SECRET): string => createInviteToken({ workspaceId: 'workspace-1', email: 'invitee@example.com',
    exp: Math.floor(Date.now() / 1000) + expSeconds }, secret);

// Providers that sign people up in their own UI (Clerk) never see the
// token; OR3 admits the new user only if a later request still carries it.
describe('invite link middleware', () => {
    beforeEach(() => {
        resetSyncRateLimits();
        lookup.mockClear();
        config.value = {
            auth: { enabled: true, registrationMode: 'invite_only', invite: { tokenSecret: SECRET } },
            security: { proxy: { trustProxy: true } },
        };
    });
    const run = async (event: H3Event) => (await import('../invite-link')).default(event);

    it('keeps a valid invite in a cookie that later requests carry, until the invite expires', async () => {
        const invite = token(3600);
        const landing = makeEvent(`/?invite=${encodeURIComponent(invite)}`);
        await run(landing);
        const [cookie] = setCookie(landing);
        expect(cookie).toMatch(new RegExp(`^${INVITE_TOKEN_COOKIE}=`));
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(cookie).toMatch(/Path=\//i);
        expect(cookie).not.toMatch(/Secure/i);
        expect(Number(/Max-Age=(\d+)/i.exec(cookie!)?.[1])).toBeGreaterThan(3590);
        expect(landing.node.res.getHeader('cache-control')).toBe('no-store');

        // After a redirect or in a new tab, the session request has no query.
        const later = makeEvent('/api/auth/session', { cookie: cookie!.split(';')[0] });
        expect(getInviteTokenFromEvent(later)).toBe(invite);
    });

    it('limits short-code guesses before lookup and never replaces a usable cookie', async () => {
        config.value.public = { sync: { provider: 'sqlite' } };
        config.value.limits = { operationRateLimits: { 'auth:invite': { windowMs: 60_000, maxRequests: 2 } } };
        const options = { cookie: `${INVITE_TOKEN_COOKIE}=${token(3600)}` };
        for (let i = 0; i < 2; i++) {
            const event = makeEvent('/?invite=ABCDEFGH', options);
            await run(event);
            expect(setCookie(event)).toEqual([]);
        }
        const blocked = makeEvent('/?invite=ABCDEFGH', options);
        await expect(run(blocked)).rejects.toMatchObject({ statusCode: 429 });
        expect(Number(blocked.node.res.getHeader('retry-after'))).toBeGreaterThan(0);
        expect(blocked.node.res.getHeader('cache-control')).toBe('no-store');
        expect(lookup).toHaveBeenCalledTimes(2);
        expect(setCookie(blocked)).toEqual([]);
    });

    it('marks the cookie Secure for HTTPS, including behind a trusted proxy', async () => {
        const event = makeEvent(`/chat?invite=${encodeURIComponent(token(3600))}`, { forwardedProto: 'https' });
        await run(event);
        expect(setCookie(event)[0]).toMatch(/Secure/i);
    });

    it.each<[string, () => string, { method?: string }]>([
        ['a forged token', () => `/?invite=${encodeURIComponent(token(3600, 'other-secret'))}`, {}],
        ['an expired token', () => `/?invite=${encodeURIComponent(token(-60))}`, {}],
        ['no invite', () => '/?other=1', {}],
        ['a non-GET request', () => `/?invite=${encodeURIComponent(token(3600))}`, { method: 'POST' }],
    ])('stores nothing for %s', async (_label, url, options) => {
        const event = makeEvent(url(), options);
        await run(event);
        expect(setCookie(event)).toEqual([]);
    });

    it.each([
        ['open registration', { auth: { enabled: true, registrationMode: 'open', invite: { tokenSecret: SECRET } } }],
        ['server auth off', { auth: { enabled: false, registrationMode: 'invite_only', invite: { tokenSecret: SECRET } } }],
        ['no invite secret', { auth: { enabled: true, registrationMode: 'invite_only', invite: {} } }],
    ])('does nothing with %s', async (_label, auth) => {
        config.value = { ...auth, security: { proxy: { trustProxy: false } } };
        const event = makeEvent(`/?invite=${encodeURIComponent(token(3600))}`);
        await run(event);
        expect(setCookie(event)).toEqual([]);
    });
});


describe('invite token purpose and framing', () => {
    const exp = 2_000_000_000;
    const email = 'invitee@example.com';
    const workspacePayload = { workspaceId: 'workspace-1', email, exp };
    const signupPayload = { purpose: 'signup', invite_id: 'signup-id', email, exp };

    it('rejects extra segments and unknown purposes without changing legacy links', () => {
        const legacy = token(3600);
        expect(verifyInviteToken(legacy, SECRET).ok).toBe(true);
        expect(verifyInviteToken(legacy + '.extra', SECRET).ok).toBe(false);
        const unknown = createInviteToken({ ...workspacePayload, purpose: 'other' } as never, SECRET);
        expect(verifyInviteToken(unknown, SECRET, 1_900_000_000_000)).toEqual({ ok: false, reason: 'invalid_payload' });
    });

    it.each<[string, unknown]>([
        ['null', null],
        ['an array', []],
        ['a primitive', 'invalid'],
        ['missing email', { workspaceId: 'workspace-1', exp }],
        ['non-string email', { ...workspacePayload, email: 42 }],
        ['blank email', { ...workspacePayload, email: ' ' }],
        ['missing expiry', { workspaceId: 'workspace-1', email }],
        ['string expiry', { ...workspacePayload, exp: String(exp) }],
        ['fractional expiry', { ...workspacePayload, exp: exp + 0.5 }],
        ['unsafe expiry', { ...workspacePayload, exp: Number.MAX_SAFE_INTEGER + 1 }],
        ['missing workspace ID', { email, exp }],
        ['non-string workspace ID', { ...workspacePayload, workspaceId: 42 }],
        ['empty workspace ID', { ...workspacePayload, workspaceId: '' }],
        ['missing signup invite ID', { purpose: 'signup', email, exp }],
        ['non-string signup invite ID', { ...signupPayload, invite_id: 42 }],
        ['empty signup invite ID', { ...signupPayload, invite_id: '' }],
    ])('rejects a correctly signed payload with %s', (_label, payload) => {
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url');
        expect(verifyInviteToken(`${encoded}.${signature}`, SECRET, 1_900_000_000_000))
            .toEqual({ ok: false, reason: 'invalid_payload' });
    });

    it('verifies a signup invitation without a destination workspace', () => {
        const payload = { purpose: 'signup' as const, invite_id: 'signup-id', email: 'invitee@example.com', exp: Math.floor(Date.now()/1000)+3600 };
        expect(verifyInviteToken(createInviteToken(payload, SECRET), SECRET)).toEqual({ ok: true, payload });
    });
});
