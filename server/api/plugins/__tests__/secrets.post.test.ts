import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, toWebHandler } from 'h3';

// This route owns derivation from the authenticated host authority. Vault authorization/crypto
// are exercised against the actual service in or3-secrets; these fixtures supply host infrastructure.
const state = vi.hoisted(() => ({
    body: {} as Record<string, unknown>,
    current: true,
    hold: undefined as Promise<void> | undefined,
    bodyHold: undefined as Promise<void> | undefined,
    bodyReads: 0,
    inspectHold: undefined as Promise<void> | undefined,
    inspections: 0,
    grants: ['secrets.read', 'secrets.write', 'secrets.use'],
    authorized: true,
    calls: [] as { input: any; context: any }[],
    session: { authenticated: true, provider: 'basic-auth', providerUserId: 'synthetic-subject', user: { id: 'internal-user' }, workspace: { id: 'workspace' } },
}));
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ auth: { enabled: true }, sync: { provider: 'sqlite' }, secrets: { provider: 'or3-secrets', namespace: 'deployment' } }) }));
vi.mock('../../../auth/session', async load => ({ ...(await load<Record<string, unknown>>()), resolveSessionContext: async () => state.session }));
vi.mock('../../../auth/can', () => ({ requireSession: (session: any) => { if (!session.authenticated) throw Object.assign(new Error('unauthorized'), { statusCode: 401 }); }, requireCan: () => {} }));
vi.mock('../../../utils/plugins/connections/api-context', () => ({ requirePluginMutation: () => {} }));
vi.mock('../../../utils/security/limited-json-body', () => ({ readLimitedJsonBody: async () => { state.bodyReads++; await state.bodyHold; return state.body; } }));
vi.mock('../../../admin/extensions/paths', () => ({ EXTENSIONS_BASE_DIR: '/fixture' }));
vi.mock('../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => ({}) }));
vi.mock('../../../admin/plugins/package-operation-support', () => ({ readPackageManifest: async () => ({ trust: 'trusted-host' }) }));
vi.mock('../../../admin/plugins/package-store', () => ({ ImmutablePluginPackageStore: class { runPluginOperation(_id: string, callback: () => unknown) { return callback(); } } }));
vi.mock('../../../utils/plugins/setup/discovery', () => ({ resolvePluginPackage: async () => ({ status: 'current', source: 'package', path: '/fixture/package', digest: 'sha256-fixture' }) }));
vi.mock('../../../utils/plugins/isolation/activation-authorization', () => ({
    authorizeHostActivation: async (input: any) => state.authorized && input.userId === 'internal-user' && input.workspaceId === 'workspace' ? { ok: true, record: { activationId: 'sealed', userId: input.userId, workspaceId: input.workspaceId, pluginId: input.pluginId, grants: { approvedGrants: state.grants } } } : { ok: false, statusCode: 403, code: 'activation-session-mismatch' },
    checkHostActivationLive: () => ({ ok: state.current }),
}));
vi.mock('../../../secrets/registry', () => ({ getActiveSecretStore: () => ({
    async inspect() { state.inspections++; await state.inspectHold; return null; },
    async put(input: any, context: any) { state.calls.push({ input, context }); return { ref: { id: 'opaque', revision: 1 } }; },
    async resolve(input: any, context: any) { state.calls.push({ input, context }); await state.hold; return { value: 'synthetic-value', meta: { ref: { id: 'opaque', revision: 1 } } }; },
    async available() {},
}) }));
import handler from '../secrets.post';
import { invalidateSharedSessionCacheForIdentity } from '../../../auth/session';
const request = () => toWebHandler(createApp().use('/api/plugins/secrets', handler))(new Request('http://localhost/api/plugins/secrets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
let clock = Date.now();
beforeEach(() => { clock += 60_001; vi.spyOn(Date, 'now').mockImplementation(() => clock); state.hold = undefined; state.bodyHold = undefined; state.bodyReads = 0; state.inspectHold = undefined; state.inspections = 0; state.body = { operation: 'get', key: 'api', pluginId: 'fixture', activationId: 'sealed' }; state.calls = []; state.current = true; state.authorized = true; state.grants = ['secrets.read', 'secrets.write', 'secrets.use']; state.session.authenticated = true; });
afterEach(() => vi.restoreAllMocks());
describe('plugin secret authority route', () => {
    it('uses internal session scope and correlates opaque acting identity without exporting the activation token', async () => {
        const response = await request();
        expect(response.status).toBe(200); expect(await response.json()).toEqual({ value: 'synthetic-value' });
        expect(state.calls[0]!.input.scope).toEqual({ namespace: 'deployment', ownerUserId: 'internal-user', workspaceId: 'workspace', consumerId: 'fixture' });
        expect(state.calls[0]!.context.actorId).toBe('internal-user');
        expect(state.calls[0]!.context.activationId).not.toBe('sealed');
        expect(state.calls[0]!.context.requestId).toBeTruthy();
    });
    it.each(['ownerUserId', 'workspaceId', 'scope', 'actorId', 'grants'])('rejects browser authority field %s', async field => {
        state.body[field] = 'foreign'; expect((await request()).status).toBe(400); expect(state.calls).toEqual([]);
    });
    it('refuses absent grants, stale authority, signed-out sessions and disabled activations before store access', async () => {
        state.grants = ['secrets.use']; expect((await request()).status).toBe(403);
        state.grants = ['secrets.read']; state.authorized = false; expect((await request()).status).toBe(403);
        state.authorized = true; state.current = false; expect((await request()).status).toBe(409);
        state.current = true; state.session.authenticated = false; expect((await request()).status).toBe(401);
        expect(state.calls).toEqual([]);
    });
    it('bounds waiting vault calls and releases slots after a stale result is discarded', async () => {
        let release!: () => void;
        state.hold = new Promise<void>(yes => { release = yes; });
        const pending = Array.from({ length: 16 }, () => request());
        let overflow: Promise<Response> | undefined;
        try {
            await vi.waitFor(() => expect(state.calls).toHaveLength(16));
            overflow = request();
            const status = await Promise.race([overflow.then(response => response.status), new Promise<number>(yes => setTimeout(() => yes(0), 100))]);
            expect(status).toBe(429);
        } finally {
            state.current = false; release();
            const results = await Promise.all(pending);
            expect(results.every(response => response.status === 409)).toBe(true);
            for (const response of results) expect(await response.text()).not.toContain('synthetic-value');
            await overflow;
        }
        state.current = true; state.hold = undefined;
        expect((await request()).status).toBe(200);
    });
    // Membership removal, role changes and workspace deletion invalidate the
    // session revision without revoking an activation. Existing liveness tests
    // cannot catch this: the handle deliberately remains live in these cases.
    it.each(['body', 'inspect', 'resolve'] as const)('fences workspace authorization changed during %s', async phase => {
        let release!: () => void;
        const hold = new Promise<void>(yes => { release = yes; });
        if (phase === 'body') state.bodyHold = hold;
        else if (phase === 'inspect') {
            state.body.operation = 'set'; state.body.value = 'synthetic-write'; state.inspectHold = hold;
        } else state.hold = hold;
        const pending = request();
        try {
            if (phase === 'body') await vi.waitFor(() => expect(state.bodyReads).toBe(1));
            else await vi.waitFor(() => expect(phase === 'inspect' ? state.inspections : state.calls.length).toBe(1));
            // The same authoritative invalidation used by membership mutation routes.
            invalidateSharedSessionCacheForIdentity({ storeId: 'sqlite' });
        } finally { release(); }
        const response = await pending;
        expect(response.status).toBe(409);
        expect(await response.text()).not.toContain('synthetic-value');
        if (phase !== 'resolve') expect(state.calls).toEqual([]);
        expect(state.current).toBe(true);
    });
    it('limits repeated requests across plugin IDs before they can grow the vault audit', async () => {
        for (let n = 0; n < 60; n++) { state.body.pluginId = `fixture-${n}`; expect((await request()).status).toBe(200); }
        const denied = await request();
        expect(denied.status).toBe(429); expect(denied.headers.get('retry-after')).toBe('60');
        expect(state.calls).toHaveLength(60);
        clock += 60_001;
        expect((await request()).status).toBe(200);
    });
});
