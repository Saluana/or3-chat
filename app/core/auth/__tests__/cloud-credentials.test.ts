import { beforeEach, expect, it, vi } from 'vitest';
import { ref } from 'vue';
const fixture = vi.hoisted(() => ({ config: { public: { ssrAuthEnabled: true } }, owner: 'account-a', status: { connected: false, persisted: false }, requests: [] as any[], rows: [] as any[], retained: [] as any[], fail: false }));
vi.mock('#imports', () => ({ useRuntimeConfig: () => fixture.config, useState: () => ({ value: { session: { authenticated: true, provider: 'basic-auth', user: { id: fixture.owner } } } }) }));
vi.mock('~/db/client', () => ({ getWorkspaceGeneration: () => 0, getDb: () => {
    const table = { where: () => ({ equals: () => ({ first: async () => fixture.rows[0], toArray: async () => fixture.rows }) }), delete: async () => { fixture.rows = []; } };
    return { name: 'or3-db-workspace', tables: [{ name: 'kv' }], table: () => table, transaction: async (_mode: string, _table: unknown, callback: () => unknown) => callback() };
} }));
vi.mock('~/db', () => ({ kv: { set: vi.fn(), delete: async () => { fixture.rows = []; } } }));
vi.mock('dexie', () => ({ default: class {
    tables = [{ name: 'kv' }];
    static getDatabaseNames = async () => fixture.retained.length ? ['or3-db-retained'] : [];
    open = async () => this; close() {}
    table = () => ({ where: () => ({ equals: () => ({ first: async () => fixture.retained[0], toArray: async () => fixture.retained }) }), delete: async () => { fixture.retained = []; } });
    transaction = async (_mode: string, _table: unknown, callback: () => unknown) => callback();
} }));
const memory = ref({ openrouterKey: null as string | null });
vi.mock('~/state/global', () => ({ state: memory }));
let auth: typeof import('../useUserApiKey');
beforeEach(async () => {
    vi.resetModules(); fixture.owner = 'account-a'; fixture.config.public.ssrAuthEnabled = true; memory.value.openrouterKey = null;
    fixture.status = { connected: false, persisted: false }; fixture.requests = []; fixture.fail = false; fixture.retained = [];
    fixture.rows = [{ id: 'key-row', name: 'openrouter_api_key', value: JSON.stringify({ owner: JSON.stringify(['basic-auth', 'account-a']), key: 'sk-or-v1-legacy-canary' }) }];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body); fixture.requests.push(body);
        if (fixture.fail) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(body.operation === 'status' ? fixture.status : { connected: true, persisted: true }));
    }));
    auth = await import('../useUserApiKey');
});
it('does not hydrate Cloud keys and exposes only connection metadata', async () => {
    await auth.hydrateUserApiKeyFromKv();
    expect(memory.value.openrouterKey).toBeNull(); expect(auth.useUserApiKey().apiKey.value).toBeNull();
    expect(fixture.rows).toHaveLength(1);
});
it('offers only an owner-matched import, retaining bytes on failure and deleting only after persistence', async () => {
    expect(await auth.findLegacyOpenRouterKey()).toBe(true);
    fixture.fail = true; await expect(auth.migrateLegacyOpenRouterKey()).rejects.toThrow(); expect(fixture.rows).toHaveLength(1);
    fixture.fail = false; await auth.migrateLegacyOpenRouterKey(); expect(fixture.rows).toHaveLength(0);
    expect(memory.value.openrouterKey).toBeNull();
    expect(fixture.requests.at(-1)).toEqual({ operation: 'migrate', key: 'sk-or-v1-legacy-canary' });
});
it('never imports an unowned or other-account value', async () => {
    fixture.owner = 'account-b'; expect(await auth.findLegacyOpenRouterKey()).toBe(false);
    await expect(auth.migrateLegacyOpenRouterKey()).rejects.toThrow(); expect(fixture.requests).toHaveLength(0);
    fixture.rows[0].value = 'sk-or-v1-unowned-canary'; expect(await auth.findLegacyOpenRouterKey()).toBe(false);
});
it.each([true, false])('discards stale device copies after a persisted server record (connected=%s)', async connected => {
    fixture.status = { connected, persisted: true }; await auth.refreshOpenRouterConnection();
    expect(fixture.rows).toHaveLength(0); expect(memory.value.openrouterKey).toBeNull();
    expect(auth.useUserApiKey().connected.value).toBe(connected);
});
it('never persists a newly supplied Cloud key to browser state', async () => {
    await auth.persistUserApiKey('sk-or-v1-new-key-canary');
    expect(fixture.requests).toContainEqual({ operation: 'save', key: 'sk-or-v1-new-key-canary' });
    expect(memory.value.openrouterKey).toBeNull();
});

it('finds an owned key in a retained workspace without importing a foreign current key', async () => {
    fixture.retained = [...fixture.rows];
    fixture.rows = [{ ...fixture.rows[0], value: JSON.stringify({ owner: 'other-account', key: 'sk-or-foreign-key-fixture' }) }];
    expect(await auth.findLegacyOpenRouterKey()).toBe(true);
    await auth.migrateLegacyOpenRouterKey();
    expect(fixture.retained).toHaveLength(0); expect(fixture.rows).toHaveLength(1);
    expect(fixture.requests.at(-1)?.key).toBe('sk-or-v1-legacy-canary');
});
