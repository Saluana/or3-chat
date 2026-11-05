import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { kv } from '~/db';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { testRuntimeConfig } from '../../../../tests/setup';
const { list, configure } = vi.hoisted(() => ({ list: vi.fn(), configure: vi.fn() }));
vi.mock('@openrouter/sdk/sdk/models.js', () => ({
    Models: class { constructor(input: unknown) { configure(input); } list = list; },
}));
import { sdkModelToLocal } from '~~/shared/openrouter';
import * as service from '~/core/auth/models-service';
import { MODELS_CACHE_KEY, useModelStore } from '../useModelStore';

function sdkModel(contextLength = 1_000_000, id = 'catalog/model') {
    return {
        id, name: 'Catalog model', canonicalSlug: 'canonical/model', contextLength,
        architecture: { inputModalities: ['text'], outputModalities: ['text'] },
        topProvider: { contextLength: 32_000, maxCompletionTokens: 4096, isModerated: false },
        pricing: { prompt: '0', completion: '0' }, supportedParameters: ['tools'],
    } as Parameters<typeof sdkModelToLocal>[0];
}
function pages(model = sdkModel()) {
    return { async *[Symbol.asyncIterator]() { yield { result: { data: [model] } }; } };
}
function browserCache(fetchedAt: number, model = sdkModel()) {
    localStorage.setItem('openrouter_model_catalog_v1', JSON.stringify({ data: [sdkModelToLocal(model)], fetchedAt }));
}
let workspace: string;
beforeEach(async () => {
    // This suite scripts the local SDK catalog transport.
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    workspace = `catalog-readiness-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb(workspace).open();
    localStorage.clear();
    list.mockReset();
    await useModelStore().invalidate();
    useModelStore().favoriteModels.value = [];
});
afterEach(async () => {
    testRuntimeConfig.value.public.ssrAuthEnabled = true;
    const name = getDb().name;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspace);
    await Dexie.delete(name);
    setHookEngine(null);
});

// Distinct catalog contract: real service/store/cache and SDK normalization.
// Only external transport is scripted. No readiness operation is mocked.
describe('existing catalog context readiness', () => {
    it('publishes a cached OpenRouter catalog while OpenAI discovery is still pending', async () => {
        testRuntimeConfig.value.public.ssrAuthEnabled = true;
        browserCache(Date.now());
        let release!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
        try {
            const pending = service.fetchModelCatalog();
            const outcome = await Promise.race([pending.then(() => 'ready'), new Promise<string>(resolve => setTimeout(() => resolve('blocked'), 250))]);
            expect(outcome).toBe('ready');
            const result = await pending;
            expect(result.data[0]!.id).toBe('catalog/model');
            expect(result.openAiPending).toBeDefined();
            release(Response.json([]));
            expect(await result.openAiPending).toEqual([]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
    it.each(['openai', 'openrouter'] as const)('prepares a ready %s model without waiting for the other platform', async platform => {
        testRuntimeConfig.value.public.ssrAuthEnabled = true;
        const id = platform === 'openai' ? '@openai/gpt-5.4-mini' : 'catalog/model';
        let release!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { release = resolve; });
        vi.stubGlobal('fetch', vi.fn((url: string) => url === `/api/${platform}/models`
            ? Promise.resolve(Response.json([sdkModelToLocal(sdkModel(32_000, id))])) : held));
        try {
            const ready = useModelStore().resolveContextModel(id);
            const outcome = await Promise.race([ready, new Promise(resolve => setTimeout(() => resolve('blocked'), 250))]);
            expect(outcome).toMatchObject({ ok: true, modelId: id, source: `${platform}-live` });
        } finally {
            release(Response.json([]));
            await vi.waitFor(() => expect(useModelStore().platformStatus.value[platform === 'openai' ? 'openrouter' : 'openai']).toBe('disconnected'));
            vi.unstubAllGlobals();
        }
    });

    it('preserves each platform timestamp through a slow stale merge and cache reload', async () => {
        testRuntimeConfig.value.public.ssrAuthEnabled = true;
        const fetchedAt = Date.now() - 3_600_001;
        browserCache(fetchedAt);
        const direct = sdkModelToLocal(sdkModel(32_000, '@openai/gpt-5.4-mini'));
        let release!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { release = resolve; });
        vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/openai/models'
            ? Promise.resolve(Response.json([direct])) : held));
        try {
            const store = useModelStore();
            await store.fetchModels({ force: true });
            const live = await store.resolveContextModel(direct.id);
            expect(live).toMatchObject({ ok: true, source: 'openai-live' });
            release(new Response('', { status: 503 }));
            await vi.waitFor(() => expect(store.catalog.value).toHaveLength(2));
            expect(await store.resolveContextModel('catalog/model')).toMatchObject({ ok: true, source: 'openrouter-cache', fetchedAt });
            expect(await store.resolveContextModel(direct.id)).toEqual(live);
            expect(store.lastLoadedAt.value).toBe(fetchedAt);
            let cached = '';
            await vi.waitFor(async () => {
                cached = (await kv.get(MODELS_CACHE_KEY))!.value as string;
                expect(JSON.parse(cached).data).toHaveLength(2);
            });
            await store.invalidate();
            await kv.set(MODELS_CACHE_KEY, cached);
            await store.loadCachedModels();
            expect(await store.resolveContextModel('catalog/model')).toMatchObject({ ok: true, source: 'openrouter-cache', fetchedAt });
            expect(await store.resolveContextModel(direct.id)).toMatchObject({ ok: true, source: 'openai-cache', fetchedAt: live.ok ? live.fetchedAt : null });
        } finally { release(new Response('', { status: 503 })); vi.unstubAllGlobals(); }
    });

    it('does not renew expired metadata merely by rewriting its KV record', async () => {
        const fetchedAt = Date.now() - 3 * 24 * 60 * 60 * 1000;
        await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1, data: [sdkModelToLocal(sdkModel(32_000))], fetchedAt }));
        list.mockImplementation(async () => pages());
        expect((await useModelStore().fetchModels())[0]?.context_length).toBe(1_000_000);
        expect(list).toHaveBeenCalledOnce();
    });

    it('does not relabel stale browser cache as a fresh store fetch', async () => {
        const fetchedAt = Date.now() - 3_600_001;
        browserCache(fetchedAt);
        list.mockRejectedValue(new Error('Scripted catalog offline'));
        await useModelStore().fetchModels({ force: true });
        expect(useModelStore().lastLoadedAt.value).toBe(fetchedAt);
    });

    it('returns factual live provenance and keeps the existing list API', async () => {
        list.mockImplementation(async () => pages());
        const catalog = await service.fetchModelCatalog({ force: true });
        expect(catalog.source).toBe('openrouter-live');
        expect(catalog.fetchedAt).toBeGreaterThan(0);
        expect(catalog.data[0]).toMatchObject({ id: 'catalog/model', context_length: 1_000_000 });
        expect(await service.fetchModels()).toEqual(catalog.data);
        expect(list).toHaveBeenCalledOnce();
    });

    it('preserves original cache provenance and time when forced refresh fails', async () => {
        const fetchedAt = Date.now() - 10_000;
        browserCache(fetchedAt);
        list.mockRejectedValue(new Error('Scripted catalog offline'));
        expect(await service.fetchModelCatalog({ force: true })).toMatchObject({
            source: 'openrouter-cache', fetchedAt, data: [expect.objectContaining({ context_length: 1_000_000 })],
        });
    });

    it('reads valid cached metadata without transport and captures exact routing identity', async () => {
        const fetchedAt = Date.now() - 1000;
        await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1, data: [sdkModelToLocal(sdkModel())], fetchedAt }));
        const result = await useModelStore().resolveContextModel('canonical/model:nitro:thinking');
        expect(result).toMatchObject({ ok: true, selectedModelId: 'canonical/model:nitro:thinking',
            modelId: 'catalog/model', source: 'openrouter-cache', fetchedAt,
            metadata: { context_length: 1_000_000, top_provider: { context_length: 32_000 } } });
        expect(list).not.toHaveBeenCalled();
        if (!result.ok) throw new Error('Unexpected unavailable model');
        useModelStore().catalog.value[0]!.context_length = 99;
        expect(result.metadata.context_length).toBe(1_000_000);
        expect(Object.isFrozen(result.metadata)).toBe(true);
    });

    it('keeps invalid capacity recoverable through a later explicit refresh', async () => {
        const invalid = sdkModel(0);
        invalid.topProvider.contextLength = 0;
        list.mockImplementation(async () => pages(invalid));
        expect(await useModelStore().resolveContextModel('catalog/model')).toMatchObject({ ok: false, code: 'model_metadata_unavailable' });
        list.mockImplementation(async () => pages());
        expect(await useModelStore().resolveContextModel('catalog/model')).toMatchObject({ ok: true, source: 'openrouter-live', metadata: { context_length: 1_000_000 } });
    });

    it('prefers an exact model ID over an earlier canonical-slug alias', async () => {
        const alias = sdkModel(1_000_000, 'alias/model'); alias.canonicalSlug = 'route/model';
        const exact = sdkModel(32_000, 'route/model');
        await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1,
            data: [sdkModelToLocal(alias), sdkModelToLocal(exact)], fetchedAt: Date.now() }));
        expect(await useModelStore().resolveContextModel('route/model:nitro:thinking')).toMatchObject({
            ok: true, selectedModelId: 'route/model:nitro:thinking', modelId: 'route/model',
            metadata: { context_length: 32_000 },
        });
        expect(list).not.toHaveBeenCalled();
    });

    it('prefers an exact favorite ID over a catalog canonical-slug fallback', async () => {
        const alias = sdkModel(1_000_000, 'alias/model'); alias.canonicalSlug = 'route/model';
        useModelStore().catalog.value = [sdkModelToLocal(alias)];
        useModelStore().favoriteModels.value = [sdkModelToLocal(sdkModel(32_000, 'route/model'))];
        expect(await useModelStore().resolveContextModel('route/model')).toMatchObject({
            ok: true, modelId: 'route/model', metadata: { context_length: 32_000 },
        });
    });

    it('does not let an older held KV hydration overwrite a completed live forced refresh', async () => {
        const fetchedAt = Date.now() - 1000;
        await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1,
            data: [sdkModelToLocal(sdkModel(32_000))], fetchedAt }));
        let release!: () => void; let entered!: () => void; let held = false;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.getByName:filter:output'>>[1] = async (row) => {
            if (!held && row?.name === MODELS_CACHE_KEY) { held = true; entered(); await gate; }
            return row;
        };
        hooks.addFilter('db.kv.getByName:filter:output', hold);
        try {
            const oldHydration = useModelStore().fetchModels();
            await started;
            list.mockImplementation(async () => pages());
            const fresh = await useModelStore().fetchModels({ force: true });
            expect(fresh[0]?.context_length).toBe(1_000_000);
            const live = await useModelStore().resolveContextModel('catalog/model');
            expect(live).toMatchObject({ ok: true, source: 'openrouter-live' });
            await vi.waitFor(async () => {
                const row = await kv.get(MODELS_CACHE_KEY);
                expect(JSON.parse(row!.value as string).data[0].context_length).toBe(1_000_000);
            });
            release(); await oldHydration;
            expect(await useModelStore().resolveContextModel('catalog/model')).toEqual(live);
            expect(list).toHaveBeenCalledOnce();
        } finally {
            release(); hooks.removeFilter('db.kv.getByName:filter:output', hold);
        }
    });

    it('fences held KV hydration when its already-started forced refresh completes first', async () => {
        await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1,
            data: [sdkModelToLocal(sdkModel(32_000))], fetchedAt: Date.now() - 1000 }));
        let releaseSdk!: () => void; let sdkEntered!: () => void;
        let releaseKv!: () => void; let kvEntered!: () => void; let held = false;
        const sdkGate = new Promise<void>((resolve) => { releaseSdk = resolve; });
        const sdkStarted = new Promise<void>((resolve) => { sdkEntered = resolve; });
        const kvGate = new Promise<void>((resolve) => { releaseKv = resolve; });
        const kvStarted = new Promise<void>((resolve) => { kvEntered = resolve; });
        list.mockImplementation(async () => { sdkEntered(); await sdkGate; return pages(); });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.getByName:filter:output'>>[1] = async (row) => {
            if (!held && row?.name === MODELS_CACHE_KEY) { held = true; kvEntered(); await kvGate; }
            return row;
        };
        hooks.addFilter('db.kv.getByName:filter:output', hold);
        try {
            const refresh = useModelStore().fetchModels({ force: true });
            await sdkStarted;
            const hydration = useModelStore().fetchModels();
            await kvStarted;
            releaseSdk(); await refresh;
            const live = await useModelStore().resolveContextModel('catalog/model');
            expect(live).toMatchObject({ ok: true, source: 'openrouter-live', metadata: { context_length: 1_000_000 } });
            await vi.waitFor(async () => {
                const row = await kv.get(MODELS_CACHE_KEY);
                expect(JSON.parse(row!.value as string).data[0].context_length).toBe(1_000_000);
            });
            releaseKv();
            expect((await hydration)[0]?.context_length).toBe(1_000_000);
            expect(await useModelStore().resolveContextModel('catalog/model')).toEqual(live);
            expect(list).toHaveBeenCalledOnce();
        } finally {
            releaseSdk(); releaseKv(); hooks.removeFilter('db.kv.getByName:filter:output', hold);
        }
    });

    // A mounted store must not reuse A's memory or publish A's suspended KV
    // result in B. The same guard covers an A→B→A navigation generation.
    it.each(['changed', 'returned'] as const)('discards workspace-owned catalog and favorites hydration (%s)', async transition => {
        const store = useModelStore();
        const row = sdkModelToLocal(sdkModel(32_000, 'origin/model'));
        await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1, data: [row], fetchedAt: Date.now() }));
        await kv.set('favorite_models', JSON.stringify([row]));
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered = 0;
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.getByName:filter:output'>>[1] = async record => {
            if (record?.name === MODELS_CACHE_KEY || record?.name === 'favorite_models') { entered++; await gate; }
            return record;
        };
        hooks.addFilter('db.kv.getByName:filter:output', hold);
        const reads = [store.loadCachedModels(), store.getFavoriteModels()];
        await vi.waitFor(() => expect(entered).toBe(2));
        const otherId = `catalog-target-${crypto.randomUUID()}`;
        const other = setActiveWorkspaceDb(otherId);
        if (transition === 'returned') setActiveWorkspaceDb(workspace);
        try {
            release(); await Promise.all(reads);
            expect(store.catalog.value).toEqual([]);
            expect(store.favoriteModels.value).toEqual([]);
        } finally {
            release(); hooks.removeFilter('db.kv.getByName:filter:output', hold);
            setActiveWorkspaceDb(workspace); evictWorkspaceDb(otherId); await Dexie.delete(other.name);
        }
    });

    it('clears loaded model state on workspace navigation without another consumer call', async () => {
        const store = useModelStore();
        const model = sdkModelToLocal(sdkModel());
        store.catalog.value = [model]; store.favoriteModels.value = [model];
        const otherId = `catalog-reset-${crypto.randomUUID()}`;
        const other = setActiveWorkspaceDb(otherId);
        try { expect(store.catalog.value).toEqual([]); expect(store.favoriteModels.value).toEqual([]); }
        finally { setActiveWorkspaceDb(workspace); evictWorkspaceDb(otherId); await Dexie.delete(other.name); }
    });

    // A slow save hook must not overwrite a subsequent unfavorite operation.
    it('keeps the latest favorites after saves complete out of order', async () => {
        const store = useModelStore(); const model = sdkModelToLocal(sdkModel());
        let release!: () => void; let entered = false;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.upsertByName:filter:input'>>[1] = async row => {
            if (!entered && row.name === 'favorite_models') { entered = true; await gate; }
            return row;
        };
        hooks.addFilter('db.kv.upsertByName:filter:input', hold);
        try {
            const add = store.addFavoriteModel(model);
            await vi.waitFor(() => expect(entered).toBe(true));
            const remove = store.removeFavoriteModel(model);
            await new Promise(resolve => setTimeout(resolve, 20));
            release(); await Promise.all([add, remove]);
            expect(JSON.parse((await kv.get('favorite_models'))!.value!)).toEqual([]);
            expect(store.favoriteModels.value).toEqual([]);
        } finally { release(); hooks.removeFilter('db.kv.upsertByName:filter:input', hold); }
    });

    it('keeps legacy KV catalogs usable with an unknown actual fetch time', async () => {
        await kv.set(MODELS_CACHE_KEY, JSON.stringify([sdkModelToLocal(sdkModel())]));
        expect(await useModelStore().resolveContextModel('catalog/model')).toMatchObject({
            ok: true, source: 'openrouter-cache', fetchedAt: null,
            metadata: { context_length: 1_000_000 },
        });
        expect(list).not.toHaveBeenCalled();
    });

    it('does not invent a timestamp for an offline legacy browser catalog', async () => {
        localStorage.setItem('openrouter_model_catalog_v1', JSON.stringify({ data: [sdkModelToLocal(sdkModel())] }));
        list.mockRejectedValue(new Error('Scripted catalog offline'));
        expect(await service.fetchModelCatalog({ force: true })).toMatchObject({
            source: 'openrouter-cache', fetchedAt: null,
        });
    });

    it('coalesces concurrent missing-model forced refreshes through the same store', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        list.mockResolvedValueOnce(pages(sdkModel(32_000, 'other/model')))
            .mockImplementationOnce(async () => { await gate; return pages(); });
        try {
            const store = useModelStore();
            const first = store.resolveContextModel('catalog/model');
            const second = store.resolveContextModel('catalog/model');
            await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
            release();
            expect(await first).toMatchObject({ ok: true });
            expect(await second).toMatchObject({ ok: true });
            expect(list).toHaveBeenCalledTimes(2);
        } finally { release(); }
    });

    it('does not return an admitted model after the waiting caller is canceled', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        list.mockImplementation(async () => { await gate; return pages(); });
        const controller = new AbortController();
        try {
            const pending = useModelStore().resolveContextModel('catalog/model', { signal: controller.signal })
                .then(() => null, (error: unknown) => error);
            await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
            const otherCaller = useModelStore().resolveContextModel('catalog/model');
            controller.abort();
            // Cancellation must settle before the shared SDK request does;
            // aborting this caller must leave the other caller's refresh alive.
            expect(await pending).toMatchObject({ name: 'AbortError' });
            release();
            expect(await otherCaller).toMatchObject({ ok: true });
            expect(list).toHaveBeenCalledOnce();
        } finally { release(); }
    });
});

// The SDK must receive the canonical saved key, even when legacy storage disagrees.
it('uses the Dexie key for catalog authentication', async () => {
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    const key = 'sk-or-v1-synthetic-catalog-key';
    await persistUserApiKey(key);
    localStorage.setItem('openrouter_api_key', 'obsolete-key');
    list.mockReturnValue(pages());
    await service.fetchModelCatalog({ force: true });
    expect(configure).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: key }));
});
