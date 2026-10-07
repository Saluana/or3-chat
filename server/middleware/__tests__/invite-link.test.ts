import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { createEvent, type H3Event } from 'h3';
import { createInviteToken } from '../../auth/invite-token';
import { getInviteTokenFromEvent, INVITE_TOKEN_COOKIE } from '../../auth/registration';

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
