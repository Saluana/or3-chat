import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { kv } from '~/db';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('~~/shared/openrouter', async (original) => ({
    ...await original<typeof import('~~/shared/openrouter')>(),
    createOpenRouterClient: () => ({ models: { list } }),
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
    workspace = `catalog-readiness-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb(workspace).open();
    localStorage.clear();
    list.mockReset();
    await useModelStore().invalidate();
    useModelStore().favoriteModels.value = [];
});
afterEach(async () => {
    const name = getDb().name;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspace);
    await Dexie.delete(name);
    setHookEngine(null);
});

// Distinct catalog contract: real service/store/cache and SDK normalization.
// Only external transport is scripted. No readiness operation is mocked.
describe('existing catalog context readiness', () => {
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
