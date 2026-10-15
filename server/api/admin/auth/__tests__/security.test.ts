import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineEventHandler, toWebHandler } from 'h3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';
import { testRuntimeConfig } from '../../../../../tests/setup';
import { writeAdminCredentials } from '../../../../admin/auth/credentials';
import adminGate from '../../../../middleware/admin-gate';
import login from '../login.post';
import changePassword from '../change-password.post';

// Transport-level contracts missing from the primitive suites: admission before
// bcrypt, bounded parsing, host gating, and session revocation after rotation.
describe('admin authentication HTTP security', () => {
    let dir: string;
    let request: ReturnType<typeof toWebHandler>;
    let sequence = 0;
    const password = 'OriginalPassword123';
    beforeEach(async () => {
        dir = await mkdtemp(`${tmpdir()}/or3-auth-security-`);
        vi.stubEnv('OR3_ADMIN_DATA_DIR', dir);
        vi.stubEnv('DISABLE_RATE_LIMIT', '0');
        vi.stubGlobal('useRuntimeConfig', () => testRuntimeConfig.value);
        testRuntimeConfig.value.admin = {
            basePath: '/admin', allowedHosts: ['admin.example.test'],
            auth: { username: '', password: '', jwtSecret: 'test-security-secret', jwtExpiry: '24h' },
        };
        testRuntimeConfig.value.security.proxy = { trustProxy: false };
        await writeAdminCredentials({ username: 'admin', password_hash_bcrypt: await bcrypt.hash(password, 4), created_at: '', updated_at: '' });
        const ip = `198.51.100.${++sequence}`;
        const app = createApp().use(defineEventHandler(event => {
            Object.defineProperty(event.node.req, 'socket', { value: { remoteAddress: ip }, configurable: true });
        })).use(adminGate).use('/api/admin/auth/login', login).use('/api/admin/auth/change-password', changePassword);
        request = toWebHandler(app);
    });
    afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); });
    const post = (path: string, body: unknown, host = 'admin.example.test', cookie = '') => request(new Request(`http://${host}/api/admin/auth/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', host, cookie }, body: JSON.stringify(body),
    }));

    it('hides login on a host outside the allowlist', async () => {
        expect((await post('login', { username: 'admin', password }, 'public.example.test')).status).toBe(404);
    });
    it('rejects oversized and malformed login bodies', async () => {
        expect((await post('login', { username: 'admin', password, padding: 'x'.repeat(9000) })).status).toBe(413);
        for (const body of [null, { username: 'admin', password: {} }]) expect((await post('login', body)).status).toBe(400);
    });
    it('admits only five concurrent password guesses', async () => {
        const responses = await Promise.all(Array.from({ length: 8 }, () => post('login', { username: 'admin', password: 'wrong' })));
        expect(responses.filter(r => r.status === 401)).toHaveLength(5);
        expect(responses.filter(r => r.status === 429)).toHaveLength(3);
    });
    it('bounds password work when usernames rotate', async () => {
        const responses = await Promise.all(Array.from({ length: 22 }, (_, n) => post('login', { username: `unknown-${n}`, password: 'wrong' })));
        expect(responses.filter(r => r.status === 429)).toHaveLength(2);
    }, 20000);
    it('revokes old sessions and renews the rotating session', async () => {
        const signedIn = await post('login', { username: 'admin', password });
        const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!;
        const rotated = await post('change-password', { currentPassword: password, newPassword: 'ReplacementPassword456' }, 'admin.example.test', cookie);
        expect(rotated.status).toBe(200);
        expect((await post('change-password', { currentPassword: 'ReplacementPassword456', newPassword: 'ThirdPassword789' }, 'admin.example.test', cookie)).status).toBe(401);
        const renewed = rotated.headers.get('set-cookie')!.split(';')[0]!;
        expect((await post('change-password', { currentPassword: 'ReplacementPassword456', newPassword: 'ThirdPassword789' }, 'admin.example.test', renewed)).status).toBe(200);
    });
    it('rejects new passwords over bcrypt’s UTF-8 byte limit', async () => {
        const signedIn = await post('login', { username: 'admin', password });
        for (const newPassword of ['Aa1'.padEnd(73, 'a'), `Aa1${'é'.repeat(36)}`]) {
            expect((await post('change-password', { currentPassword: password, newPassword }, 'admin.example.test', signedIn.headers.get('set-cookie')!.split(';')[0]!)).status).toBe(400);
        }
    });
});
