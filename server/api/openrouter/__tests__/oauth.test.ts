import { beforeEach, expect, it, vi } from 'vitest';
import { createApp, toWebHandler } from 'h3';
const fixture = vi.hoisted(() => ({ userId: 'account-a', saved: vi.fn(), fetch: vi.fn() }));
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ auth: { enabled: true }, secrets: { provider: 'or3-secrets' }, security: { proxy: {}, allowedOrigins: [] } }) }));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => ({ authenticated: true, user: { id: fixture.userId }, workspace: { id: 'workspace' } }) }));
vi.mock('../../../auth/can', () => ({ requireCan: () => {} }));
vi.mock('../../../secrets/openrouter', () => ({ openRouterCredentialOperation: (...args: unknown[]) => fixture.saved(...args) }));
import handler from '../oauth';
const request = toWebHandler(createApp().use('/api/openrouter/oauth', handler));
beforeEach(() => {
    fixture.userId = 'account-a'; fixture.saved.mockReset().mockResolvedValue({ connected: true, persisted: true });
    fixture.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ key: 'sk-or-v1-oauth-secret-canary' })));
    vi.stubGlobal('fetch', fixture.fetch);
});
async function start() {
    const response = await request(new Request('http://localhost/api/openrouter/oauth', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: '{}' }));
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.origin).toBe('https://openrouter.ai');
    return { state: url.searchParams.get('state')!, cookie: response.headers.get('set-cookie')!.split(';')[0]! };
}
it('exchanges and persists on the server, returning only a clean status redirect', async () => {
    const attempt = await start();
    const response = await request(new Request(`http://localhost/api/openrouter/oauth?code=one-use-code&state=${attempt.state}`, { headers: { host: 'localhost', cookie: attempt.cookie } }));
    expect(response.status).toBe(302); expect(response.headers.get('location')).toBe('/openrouter-callback?connection=connected');
    expect(await response.text()).not.toContain('sk-or-');
    expect(fixture.saved.mock.calls[0]![1]).toEqual({ operation: 'save', key: 'sk-or-v1-oauth-secret-canary' });
    expect(fixture.fetch.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(fixture.fetch.mock.calls[0]![1].redirect).toBe('error');
});
it.each(['account', 'state', 'cookie'])('refuses an OAuth %s mismatch before exchange', async mismatch => {
    const attempt = await start();
    if (mismatch === 'account') fixture.userId = 'account-b';
    const response = await request(new Request(`http://localhost/api/openrouter/oauth?code=one-use-code&state=${mismatch === 'state' ? 'foreign' : attempt.state}`, { headers: { host: 'localhost', cookie: mismatch === 'cookie' ? '' : attempt.cookie } }));
    expect(response.headers.get('location')).toBe('/openrouter-callback?connection=failed');
    expect(fixture.fetch).not.toHaveBeenCalled(); expect(fixture.saved).not.toHaveBeenCalled();
});
it('does not claim connection success when vault persistence fails', async () => {
    const attempt = await start(); fixture.saved.mockRejectedValue(new Error('private vault detail'));
    const response = await request(new Request(`http://localhost/api/openrouter/oauth?code=one-use-code&state=${attempt.state}`, { headers: { host: 'localhost', cookie: attempt.cookie } }));
    expect(response.headers.get('location')).toBe('/openrouter-callback?connection=failed');
    expect(await response.text()).not.toContain('private vault detail');
});
