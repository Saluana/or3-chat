import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, type Ref } from 'vue';
import Dexie from 'dexie';
import { flushPromises } from '@vue/test-utils';

describe('useUserApiKey', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('skips kv hydration when kv table is unavailable', async () => {
        const table = vi.fn();
        const stateRef = ref({ openrouterKey: 'seed' as string | null });

        vi.doMock('~/db/client', () => ({ getWorkspaceGeneration: () => 0,
            getDb: () => ({
                tables: [{ name: 'messages' }],
                table,
            }),
        }));
        vi.doMock('~/state/global', () => ({
            state: stateRef,
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        await mod.hydrateUserApiKeyFromKv();

        expect(table).not.toHaveBeenCalled();
        expect(stateRef.value.openrouterKey).toBe('seed');
    });

    it('hydrates key from kv safely', async () => {
        const first = vi.fn().mockResolvedValue({
            id: 'kv-openrouter',
            name: 'openrouter_api_key',
            value: 'or-key-123',
        });
        const equals = vi.fn().mockReturnValue({ first });
        const where = vi.fn().mockReturnValue({ equals });
        const table = vi.fn().mockReturnValue({ where });
        const stateRef = ref({ openrouterKey: null as string | null });

        vi.doMock('~/db/client', () => ({ getWorkspaceGeneration: () => 0,
            getDb: () => ({
                tables: [{ name: 'kv' }],
                table,
            }),
        }));
        vi.doMock('~/state/global', () => ({
            state: stateRef,
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        await mod.hydrateUserApiKeyFromKv();

        expect(stateRef.value.openrouterKey).toBe('or-key-123');
        expect(table).toHaveBeenCalledTimes(1);
        expect(where).toHaveBeenCalledWith('name');
        expect(equals).toHaveBeenCalledWith('openrouter_api_key');
        expect(first).toHaveBeenCalledTimes(1);
    });

    it('validates OpenRouter key format', async () => {
        vi.doMock('~/db/client', () => ({ getWorkspaceGeneration: () => 0, getDb: () => ({ tables: [] }) }));
        vi.doMock('~/db', () => ({ kv: { set: vi.fn() } }));
        vi.doMock('~/state/global', () => ({
            state: ref({ openrouterKey: null }),
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        expect(mod.isValidOpenRouterKeyFormat('sk-or-v1-abcdefghij')).toBe(
            true
        );
        expect(mod.isValidOpenRouterKeyFormat('sk-or-short')).toBe(false);
        expect(mod.isValidOpenRouterKeyFormat('not-a-key')).toBe(false);
    });

    it('persistUserApiKey writes kv and updates state', async () => {
        const kvSet = vi.fn().mockResolvedValue(undefined);
        const stateRef = ref({ openrouterKey: null as string | null });

        vi.doMock('~/db/client', () => ({ getWorkspaceGeneration: () => 0, getDb: () => ({ tables: [] }) }));
        vi.doMock('~/db', () => ({ kv: { set: kvSet } }));
        vi.doMock('~/state/global', () => ({ state: stateRef }));

        const mod = await import('~/core/auth/useUserApiKey');
        const key = 'sk-or-v1-abcdefghijklmnop';
        await mod.persistUserApiKey(key);

        expect(kvSet).toHaveBeenCalledWith('openrouter_api_key', key, expect.anything(), { isValid: expect.any(Function) });
        expect(stateRef.value.openrouterKey).toBe(key);
    });

    it('persistUserApiKey rejects invalid keys without writing', async () => {
        const kvSet = vi.fn();
        vi.doMock('~/db/client', () => ({ getWorkspaceGeneration: () => 0, getDb: () => ({ tables: [] }) }));
        vi.doMock('~/db', () => ({ kv: { set: kvSet } }));
        vi.doMock('~/state/global', () => ({
            state: ref({ openrouterKey: null }),
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        await expect(mod.persistUserApiKey('bad-key')).rejects.toThrow(
            /sk-or-/
        );
        expect(kvSet).not.toHaveBeenCalled();
    });
});


// Exercise production hydration, KV transactions and logout with synthetic keys.
// Only unrelated logout services are mocked; IndexedDB is supplied by fake-indexeddb.
describe('personal key lifecycle', () => {
    const oldKey = 'sk-or-v1-synthetic-old-key';
    const newKey = 'sk-or-v1-synthetic-new-key';
    let client: typeof import('~/db/client');
    let auth: typeof import('~/core/auth/useUserApiKey');
    let storage: typeof import('~/db');
    let logout: typeof import('~/utils/logout-cleanup');
    let db: import('~/db/client').Or3DB;
    let stateRef: Ref<{ openrouterKey: string | null }>;

    function deferred<T>() {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((done) => { resolve = done; });
        return { promise, resolve };
    }

    beforeEach(async () => {
        vi.resetModules();
        vi.doUnmock('~/core/auth/useUserApiKey');
        vi.doUnmock('~/db/client');
        vi.doUnmock('~/db');
        stateRef = ref({ openrouterKey: null as string | null });
        vi.doMock('~/state/global', () => ({ state: stateRef }));
        vi.doMock('~/utils/workspace-db-logout', () => ({ clearWorkspaceDbsOnLogout: vi.fn() }));
        vi.doMock('~/composables/plugins/portable-client-runtime', () => ({ stopAllPortableClientsAndAwait: vi.fn() }));
        client = await import('~/db/client');
        const { setHookEngine } = await import('~/core/hooks/useHooks');
        const { createHookEngine } = await import('~/core/hooks/hooks');
        const { createTypedHookEngine } = await import('~/core/hooks/typed-hooks');
        setHookEngine(createTypedHookEngine(createHookEngine()));
        db = client.setActiveWorkspaceDb('synthetic-key-lifecycle');
        storage = await import('~/db');
        auth = await import('~/core/auth/useUserApiKey');
        logout = await import('~/utils/logout-cleanup');
        await auth.persistUserApiKey(oldKey);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        client.setActiveWorkspaceDb(null);
        client.evictWorkspaceDb('synthetic-key-lifecycle');
        await db.delete();
        await client.getDefaultDb().kv.where('name').equals('workspace.logout.policy.synthetic-key-lifecycle').delete();
    });

    it('invalidates pending hydration immediately at logout entry', async () => {
        const read = deferred<unknown>();
        vi.spyOn(db, 'table').mockReturnValue({ where: () => ({ equals: () => ({ first: () => read.promise }) }) } as never);
        const hydration = auth.hydrateUserApiKeyFromKv();
        const stop = deferred<void>();
        const cleanup = logout.logoutCleanup({ $syncEngine: { stop: () => stop.promise } } as never);
        expect(stateRef.value.openrouterKey).toBeNull();
        read.resolve({ value: oldKey });
        await hydration;
        expect(stateRef.value.openrouterKey).toBeNull();
        stop.resolve();
        await cleanup;
        expect(stateRef.value.openrouterKey).toBeNull();
    });

    it('rejects hydration that finishes after logout cleanup', async () => {
        const read = deferred<unknown>();
        vi.spyOn(db, 'table').mockReturnValue({ where: () => ({ equals: () => ({ first: () => read.promise }) }) } as never);
        const hydration = auth.hydrateUserApiKeyFromKv();
        await logout.logoutCleanup();
        read.resolve({ value: oldKey });
        await hydration;
        expect(stateRef.value.openrouterKey).toBeNull();
    });

    it('clears a previous account key before switching its workspace DB', async () => {
        const session = ref({ session: { authenticated: true, user: { id: 'synthetic-account-a' } } });
        vi.doMock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => ({ data: session, refresh: vi.fn() }) }));
        vi.doMock('~/composables/workspace/useWorkspaceManager', () => ({ useWorkspaceManager: () => ({ activeWorkspaceId: ref(null) }) }));
        vi.stubGlobal('defineNuxtPlugin', (callback: () => unknown) => callback());
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { ssrAuthEnabled: true } }));
        vi.stubGlobal('useNuxtApp', () => ({}));
        try {
            await (await import('~/plugins/00-workspace-db.client')).default;
            session.value = { session: { authenticated: true, user: { id: 'synthetic-account-b' } } };
            expect(stateRef.value.openrouterKey).toBeNull();
            client.setActiveWorkspaceDb(null);
            await auth.hydrateUserApiKeyFromKv();
            expect(stateRef.value.openrouterKey).toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('ignores sign-out confirmation that finishes after a new account signs in', async () => {
        const confirmation = deferred<boolean>();
        const session = ref({ session: { authenticated: true, user: { id: 'synthetic-account-a' } } });
        vi.doMock('~/composables/auth/confirmClientSignedOut', () => ({ confirmClientSignedOut: () => confirmation.promise }));
        vi.doMock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => ({ data: session, refresh: vi.fn() }) }));
        vi.doMock('~/composables/workspace/useWorkspaceManager', () => ({ useWorkspaceManager: () => ({ activeWorkspaceId: ref(null) }) }));
        vi.stubGlobal('defineNuxtPlugin', (callback: () => unknown) => callback());
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { ssrAuthEnabled: true } }));
        vi.stubGlobal('useNuxtApp', () => ({}));
        try {
            await (await import('~/plugins/00-workspace-db.client')).default;
            session.value = { session: { authenticated: false, user: { id: 'synthetic-account-a' } } };
            await nextTick();
            session.value = { session: { authenticated: true, user: { id: 'synthetic-account-b' } } };
            await auth.persistUserApiKey(newKey);
            confirmation.resolve(true);
            await flushPromises();
            expect(stateRef.value.openrouterKey).toBe(newKey);
            expect((await storage.kv.get('openrouter_api_key', db))?.value).toBe(newKey);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('rejects a pending read across workspace changes, including returning to the same DB', async () => {
        const read = deferred<unknown>();
        vi.spyOn(db, 'table').mockReturnValue({ where: () => ({ equals: () => ({ first: () => read.promise }) }) } as never);
        stateRef.value.openrouterKey = null;
        const hydration = auth.hydrateUserApiKeyFromKv();
        client.setActiveWorkspaceDb(null);
        client.setActiveWorkspaceDb('synthetic-key-lifecycle');
        read.resolve({ value: oldKey });
        await hydration;
        expect(stateRef.value.openrouterKey).toBeNull();
    });

    it('keeps an established personal key during a same-user workspace switch', async () => {
        client.setActiveWorkspaceDb(null);
        expect(stateRef.value.openrouterKey).toBe(oldKey);
    });

    it('clears memory despite a storage failure and supports repeated cleanup', async () => {
        vi.spyOn(storage.kv, 'delete').mockRejectedValueOnce(new Error('synthetic storage failure'));
        await logout.logoutCleanup();
        expect(stateRef.value.openrouterKey).toBeNull();
        await logout.logoutCleanup();
        expect(stateRef.value.openrouterKey).toBeNull();
        expect(await storage.kv.get('openrouter_api_key', db)).toBeUndefined();
    });

    it('does not erase a newly saved key when old logout cleanup finishes', async () => {
        // Include the production clear-on-logout policy, not just KV deletion.
        vi.doUnmock('~/utils/workspace-db-logout');
        vi.resetModules();
        // Keep the auth/DB owners shared with logout after resetting the cache.
        vi.doMock('~/core/auth/useUserApiKey', () => auth);
        vi.doMock('~/db/client', () => client);
        vi.doMock('~/db', () => storage);
        const { setHookEngine } = await import('~/core/hooks/useHooks');
        const { createHookEngine } = await import('~/core/hooks/hooks');
        const { createTypedHookEngine } = await import('~/core/hooks/typed-hooks');
        setHookEngine(createTypedHookEngine(createHookEngine()));
        logout = await import('~/utils/logout-cleanup');
        const baseDb = client.getDefaultDb();
        await storage.kv.set('workspace.logout.policy.synthetic-key-lifecycle', 'clear', baseDb);
        const stop = deferred<void>();
        const cleanup = logout.logoutCleanup({ $syncEngine: { stop: () => stop.promise } } as never);
        await auth.persistUserApiKey(newKey);
        stop.resolve();
        await cleanup;
        expect(stateRef.value.openrouterKey).toBe(newKey);
        expect((await storage.kv.get('openrouter_api_key', db))?.value).toBe(newKey);
    });

    it.each(['logout', 'workspace'] as const)('rejects a pending key save across %s', async (transition) => {
        const entered = deferred<void>();
        const resume = deferred<void>();
        const open = db.open.bind(db);
        vi.spyOn(db, 'isOpen').mockReturnValueOnce(false);
        vi.spyOn(db, 'open').mockImplementationOnce(() => {
            entered.resolve();
            return Dexie.Promise.resolve(resume.promise).then(() => open());
        });
        const saving = auth.persistUserApiKey(newKey);
        const rejected = expect(saving).rejects.toBeDefined();
        await entered.promise;
        if (transition === 'logout') await logout.logoutCleanup();
        else client.setActiveWorkspaceDb(null);
        resume.resolve();
        await rejected;
        expect(stateRef.value.openrouterKey).toBe(transition === 'logout' ? null : oldKey);
        expect((await storage.kv.get('openrouter_api_key', db))?.value).not.toBe(newKey);
    });

    it('does not let a queued old delete remove a replacement key', async () => {
        const entered = deferred<void>();
        const resume = deferred<void>();
        const open = db.open.bind(db);
        vi.spyOn(db, 'isOpen').mockReturnValueOnce(false);
        vi.spyOn(db, 'open').mockImplementationOnce(() => {
            entered.resolve();
            return Dexie.Promise.resolve(resume.promise).then(() => open());
        });
        const clearing = auth.clearPersistedUserApiKey().catch(() => undefined);
        await entered.promise;
        await auth.persistUserApiKey(newKey);
        resume.resolve();
        await clearing;
        expect(stateRef.value.openrouterKey).toBe(newKey);
        expect((await storage.kv.get('openrouter_api_key', db))?.value).toBe(newKey);
    });
});
