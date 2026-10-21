import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
const fixture = vi.hoisted(() => ({
    cloud: true,
    config: {} as Record<string, any>,
    session: { authenticated: true, user: { id: 'account-a' }, workspace: { id: 'workspace-a' } },
    resolve: vi.fn(), inspect: vi.fn(), put: vi.fn(), delete: vi.fn(),
    authorize: vi.fn(),
}));
vi.mock('#imports', () => ({ useRuntimeConfig: () => fixture.config }));
vi.mock('../../auth/session', () => ({ resolveSessionContext: async () => fixture.session }));
vi.mock('../../auth/can', () => ({ requireCan: (...args: unknown[]) => fixture.authorize(...args) }));
vi.mock('../../utils/auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => fixture.cloud }));
vi.mock('../registry', () => ({ getActiveSecretStore: () => fixture.config.secrets.provider ? fixture : null }));
import { resolveOpenRouterCredential, openRouterCredentialOperation } from '../openrouter';
const event = { context: {}, method: 'POST', node: { req: { headers: { host: 'chat.test', origin: 'http://chat.test', 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', 'x-or3-openrouter-key': 'browser-key' } }, res: {} } } as unknown as H3Event;
beforeEach(() => {
    vi.clearAllMocks(); fixture.cloud = true;
    fixture.session = { authenticated: true, user: { id: 'account-a' }, workspace: { id: 'workspace-a' } };
    fixture.config = { auth: { enabled: true }, security: { proxy: {}, allowedOrigins: [] }, secrets: { provider: 'or3-secrets', namespace: 'deployment' }, openrouterApiKey: 'instance-key', openrouterAllowUserOverride: true, openrouterRequireUserKey: false };
    fixture.resolve.mockResolvedValue({ value: 'sk-or-v1-account-a-fixture' });
    fixture.inspect.mockResolvedValue(null);
    fixture.put.mockResolvedValue({ ref: { id: 'opaque', revision: 1 }, state: 'available' });
});
describe('OpenRouter credential policy', () => {
    it.each([
        [true, false, true, 'sk-or-v1-account-a-fixture', 'personal'],
        [false, true, true, 'sk-or-v1-account-a-fixture', 'personal'],
        [false, false, true, 'instance-key', 'server'],
        [false, true, false, 'instance-key', 'server'],
        [true, true, false, undefined, 'personal'],
    ])('billing matrix require=%s override=%s connected=%s', async (required, override, connected, key, source) => {
        fixture.config.openrouterRequireUserKey = required; fixture.config.openrouterAllowUserOverride = override;
        if (!connected) fixture.resolve.mockRejectedValue({ code: 'not_found' });
        const result = await resolveOpenRouterCredential(event);
        expect(result).toEqual({ apiKey: key, source });
        if (!required && !override) expect(fixture.resolve).not.toHaveBeenCalled();
    });
    it('derives an account scope across authorized workspaces and never consumes browser keys', async () => {
        await resolveOpenRouterCredential(event);
        fixture.session.workspace.id = 'workspace-b';
        await resolveOpenRouterCredential(event);
        const scopes = fixture.resolve.mock.calls.map(call => call[0].scope);
        expect(scopes[0]).toEqual({ namespace: 'deployment', ownerUserId: 'account-a', workspaceId: '@account', consumerId: '@or3.openrouter' });
        expect(scopes[1]).toEqual(scopes[0]);
        fixture.session.user.id = 'account-b'; await resolveOpenRouterCredential(event);
        expect(fixture.resolve.mock.calls[2]![0].scope.ownerUserId).toBe('account-b');
        expect(fixture.authorize).toHaveBeenCalled();
    });
    it('fails closed on vault outage and disabled BYOK without instance-key fallback', async () => {
        fixture.resolve.mockRejectedValue(new Error('synthetic private detail'));
        await expect(resolveOpenRouterCredential(event)).rejects.toMatchObject({ statusCode: 503 });
        fixture.config.secrets.provider = ''; fixture.config.openrouterRequireUserKey = true;
        await expect(resolveOpenRouterCredential(event)).rejects.toMatchObject({ statusCode: 503 });
        fixture.config.openrouterRequireUserKey = false;
        expect(await resolveOpenRouterCredential(event)).toEqual({ apiKey: 'instance-key', source: 'server' });
    });
    it('requires authenticated workspace authority before looking up a credential', async () => {
        fixture.session.authenticated = false;
        await expect(resolveOpenRouterCredential(event)).rejects.toMatchObject({ statusCode: 401 });
        expect(fixture.resolve).not.toHaveBeenCalled();
    });
    it('preserves explicit caller BYOK on non-Cloud servers', async () => {
        fixture.cloud = false;
        expect(await resolveOpenRouterCredential(event)).toEqual({ apiKey: 'browser-key', source: 'personal' });
        expect(fixture.resolve).not.toHaveBeenCalled();
    });
    it('returns metadata only, persists before responding, and refuses stale imports including tombstones', async () => {
        const result = await openRouterCredentialOperation(fixture.session as any, { operation: 'save', key: 'sk-or-v1-account-a-fixture' });
        expect(JSON.stringify(result)).not.toContain('sk-or-');
        expect(fixture.put.mock.calls[0]![0]).toMatchObject({ value: 'sk-or-v1-account-a-fixture', expectedRevision: 0 });
        for (const state of ['available', 'deleted']) {
            fixture.inspect.mockResolvedValue({ ref: { id: 'opaque', revision: 2 }, state });
            await expect(openRouterCredentialOperation(fixture.session as any, { operation: 'migrate', key: 'sk-or-v1-old-device-fixture' })).rejects.toMatchObject({ statusCode: 409 });
        }
        expect(fixture.put).toHaveBeenCalledTimes(1);
    });
    it('rejects secret-operation authority injection and invalid keys before store access', async () => {
        for (const body of [{ operation: 'save', key: 'bad-key' }, { operation: 'status', ownerUserId: 'foreign' }, { operation: 'get' }, { operation: 'save', key: 'sk-or-v1-fixture-key', scope: {} }]) {
            await expect(openRouterCredentialOperation(fixture.session as any, body)).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(fixture.inspect).not.toHaveBeenCalled(); expect(fixture.resolve).not.toHaveBeenCalled();
    });
});
