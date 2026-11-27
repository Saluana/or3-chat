import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createRouter, getHeader, toWebHandler } from 'h3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import submit from '../chat-report.post';
import list from '../../admin/chat-reports.get';

const fixture = vi.hoisted(() => ({
    userId: '',
    config: { auth: { enabled: true }, public: { errorReportingEnabled: true, appVersion: '0.1.141' },
        admin: { auth: { username: 'test-admin', password: 'unused-for-test' }, allowedHosts: ['localhost'] },
        security: { proxy: {}, allowedOrigins: ['http://other.example'] } },
}));
vi.mock('#imports', () => ({ useRuntimeConfig: () => fixture.config }));
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: async (event: Parameters<typeof getHeader>[0]) =>
        getHeader(event, 'cookie') === 'chat=test'
            ? { authenticated: true, provider: 'basic', user: { id: fixture.userId } }
            : { authenticated: false },
}));
// Admin authentication has its own cookie integration coverage. Supply the
// authenticated principal to exercise the real requireSupportAdmin guard.
vi.mock('../../../admin/api', () => ({
    requireAdminApiContext: async (event: Parameters<typeof getHeader>[0], options: {superAdminCookieOnly?: boolean}) => ({
        principal: getHeader(event, 'cookie') === 'admin=test' && options.superAdminCookieOnly
            ? { kind: 'super_admin', username: 'test-admin' } : { kind: 'workspace_admin' },
    }),
}));

const report = {
    id: '1ff7da83-ccb8-4753-bb74-00c1268e661e',
    appVersion: '0.1.141',
    localRequestId: '99e00e04-18cf-4492-bb0c-4b8169f2cfd3',
    code: 'ERR_INTERNAL',
    source: 'unknown',
    stage: 'before_save_confirmation',
    checkpoint: 'check_model',
    retryable: false,
};
const request = toWebHandler(createApp().use(createRouter()
    .post('/api/diagnostics/chat-report', submit)
    .get('/api/admin/chat-reports', list)));
function post(body: unknown, headers: Record<string, string> = {}) {
    return request(new Request('http://localhost/api/diagnostics/chat-report', {
        method: 'POST', body: JSON.stringify(body), headers: {
            host: 'localhost', origin: 'http://localhost', 'x-or3-cloud-intent': 'chat-report',
            'content-type': 'application/json',
            cookie: 'chat=test', 'x-or3-account': JSON.stringify(['basic', fixture.userId]),
            ...headers,
        },
    }));
}
const inbox = (cookie: string) => request(new Request('http://localhost/api/admin/chat-reports', {
    headers: { host: 'localhost', cookie },
}));
let directory = '';
beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'or3-chat-reports-'));
    vi.stubEnv('OR3_ADMIN_DATA_DIR', directory);
    fixture.userId = directory.split('/').at(-1)!;
    fixture.config.public.errorReportingEnabled = true;
});
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { force: true, recursive: true });
});

it('accepts only intended same-origin signed-in submissions and never stores private extra fields', async () => {
    expect((await post(report, { origin: 'http://other.example' })).status).toBe(403);
    expect((await post(report, { 'x-or3-cloud-intent': 'mutation' })).status).toBe(403);
    expect((await post(report, { cookie: '' })).status).toBe(401);
    expect((await post(report, { 'x-or3-account': '["basic","previous-account"]' })).status).toBe(409);
    expect((await post({ ...report, prompt: 'private input' })).status).toBe(400);
    expect((await post({ ...report, code: 'ERR_fabricated' })).status).toBe(400);
    expect((await post({ ...report, appVersion: '1.2.3-untrusted' })).status).toBe(409);
    const response = await inbox('admin=test');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reports: [] });
});

it('stores a single retryable receipt, visible only to a site administrator and pruned after its retention window', async () => {
    const first = await post(report);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect((await post(report)).status).toBe(200);
    expect((await inbox('chat=test')).status).toBe(403);
    const response = await inbox('admin=test');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { reports } = await response.json();
    expect(reports).toEqual([{ ...report, receivedAt: expect.any(Number) }]);
    expect(JSON.stringify(reports)).not.toContain(fixture.userId);
    vi.spyOn(Date, 'now').mockReturnValue(reports[0].receivedAt + 31 * 86_400_000);
    expect(await (await inbox('admin=test')).json()).toEqual({ reports: [] });
    expect(await readFile(join(directory, 'chat-diagnostic-reports.json'), 'utf8')).toBe('[]');
});

it('refuses collection and access when the site has not opted in', async () => {
    fixture.config.public.errorReportingEnabled = false;
    expect((await post(report)).status).toBe(404);
    expect((await inbox('admin=test')).status).toBe(404);
});
