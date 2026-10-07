import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { OpenRouterModel } from '~/core/auth/models-service';

// Mock Orama module
const mockOramaModule = {
    create: vi.fn(),
    insertMultiple: vi.fn(),
    search: vi.fn(),
    insert: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
};

// Store original window for SSR test
const originalWindow = global.window;

describe('Orama search helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset module cache by re-importing
        vi.resetModules();
    });

    afterEach(() => {
        // Restore window if we deleted it
        if (!global.window && originalWindow) {
            global.window = originalWindow;
        }
    });

    describe('importOrama', () => {
        it('should successfully import Orama on client', async () => {
            // Mock dynamic import
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { importOrama } = await import('../orama');
            const result = await importOrama();
            
            expect(result).toBeDefined();
        });

        it('should throw error when called on server (SSR guard)', async () => {
            // Remove window to simulate SSR
            const win = global.window;
            // @ts-ignore
            delete global.window;
            
            const { importOrama } = await import('../orama');
            
            await expect(importOrama()).rejects.toThrow('SSR guard');
            
            // Restore
            global.window = win;
        });

        it('should memoize import after first success', async () => {
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { importOrama } = await import('../orama');
            const first = await importOrama();
            const second = await importOrama();
            
            // Same reference indicates memoization
            expect(first).toBe(second);
        });
    });

    describe('createDb', () => {
        it('should create database with given schema', async () => {
            const mockDb = { id: 'test-db' };
            mockOramaModule.create.mockResolvedValue(mockDb);
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { createDb } = await import('../orama');
            const schema = { id: 'string', title: 'string' };
            const db = await createDb(schema);
            
            expect(mockOramaModule.create).toHaveBeenCalledWith({ schema });
            expect(db).toBe(mockDb);
        });
    });

    describe('buildIndex', () => {
        it('should insert documents into database', async () => {
            const mockDb = { id: 'test-db' };
            mockOramaModule.insertMultiple.mockResolvedValue(undefined);
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { buildIndex } = await import('../orama');
            const docs = [
                { id: '1', title: 'Doc 1' },
                { id: '2', title: 'Doc 2' },
            ];
            
            const result = await buildIndex(mockDb, docs);
            
            expect(mockOramaModule.insertMultiple).toHaveBeenCalledWith(mockDb, docs);
            expect(result).toBe(mockDb);
        });

        it('should return db immediately for empty docs array', async () => {
            const mockDb = { id: 'test-db' };
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { buildIndex } = await import('../orama');
            const result = await buildIndex(mockDb, []);
            
            expect(mockOramaModule.insertMultiple).not.toHaveBeenCalled();
            expect(result).toBe(mockDb);
        });
    });

    describe('searchWithIndex', () => {
        it('should search with term and limit', async () => {
            const mockResults = { hits: [{ id: '1', score: 0.9 }] };
            mockOramaModule.search.mockResolvedValue(mockResults);
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { searchWithIndex } = await import('../orama');
            const mockDb = { id: 'test-db' };
            const results = await searchWithIndex(mockDb, 'test query', 50);
            
            expect(mockOramaModule.search).toHaveBeenCalledWith(mockDb, {
                term: 'test query',
                limit: 50,
            });
            expect(results).toStrictEqual(mockResults);
        });

        it('should use default limit of 100', async () => {
            mockOramaModule.search.mockResolvedValue({ hits: [] });
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { searchWithIndex } = await import('../orama');
            const mockDb = { id: 'test-db' };
            await searchWithIndex(mockDb, 'test');
            
            expect(mockOramaModule.search).toHaveBeenCalledWith(mockDb, {
                term: 'test',
                limit: 100,
            });
        });

        it('should return empty hits if search returns null/undefined', async () => {
            mockOramaModule.search.mockResolvedValue(null);
            vi.doMock('@orama/orama', () => mockOramaModule);
            
            const { searchWithIndex } = await import('../orama');
            const mockDb = { id: 'test-db' };
            const results = await searchWithIndex(mockDb, 'test');
            
            expect(results).toEqual({ hits: [] });
        });

        it('should forward boost, tolerance, properties, and offset', async () => {
            mockOramaModule.search.mockResolvedValue({ hits: [] });
            vi.doMock('@orama/orama', () => mockOramaModule);

            const { searchWithIndex } = await import('../orama');
            const mockDb = { id: 'test-db' };
            await searchWithIndex(mockDb, 'test', 24, {
                properties: ['title', 'body'],
                boost: { title: 5, body: 1 },
                tolerance: 1,
                offset: 0,
            });

            expect(mockOramaModule.search).toHaveBeenCalledWith(mockDb, {
                term: 'test',
                limit: 24,
                properties: ['title', 'body'],
                boost: { title: 5, body: 1 },
                tolerance: 1,
                offset: 0,
            });
        });
    });

    describe('insertDocumentsBatched', () => {
        it('should insert in batches', async () => {
            mockOramaModule.insertMultiple.mockResolvedValue(undefined);
            vi.doMock('@orama/orama', () => mockOramaModule);

            const { insertDocumentsBatched } = await import('../orama');
            const mockDb = { id: 'test-db' };
            const docs = Array.from({ length: 3 }, (_, i) => ({ id: String(i) }));
            await insertDocumentsBatched(mockDb, docs, {
                batchSize: 2,
                yieldBetweenBatches: false,
            });

            expect(mockOramaModule.insertMultiple).toHaveBeenCalledTimes(2);
        });
    });

    describe('createTokenCounter', () => {
        it('should create independent token counters', async () => {
            const { createTokenCounter } = await import('../orama');
            
            const counter1 = createTokenCounter();
            const counter2 = createTokenCounter();
            
            expect(counter1.next()).toBe(1);
            expect(counter1.next()).toBe(2);
            expect(counter2.next()).toBe(1); // Independent counter
            expect(counter1.current()).toBe(2);
            expect(counter2.current()).toBe(1);
        });

        it('should support race-guard pattern', async () => {
            const { createTokenCounter } = await import('../orama');
            
            const counter = createTokenCounter();
            const token1 = counter.next(); // 1
            const token2 = counter.next(); // 2
            
            // Simulate async results arriving out of order
            const isStale1 = token1 !== counter.current(); // true (stale)
            const isStale2 = token2 !== counter.current(); // false (latest)
            
            expect(isStale1).toBe(true);
            expect(isStale2).toBe(false);
        });
    });

    describe('insertDoc', () => {
        it('should insert a single document', async () => {
            const mockDb = { id: 'test-db' };
            mockOramaModule.insert.mockResolvedValue('new-id');
            vi.doMock('@orama/orama', () => mockOramaModule);

            const { insertDoc } = await import('../orama');
            const doc = { title: 'New Doc' };
            const result = await insertDoc(mockDb, doc);

            expect(mockOramaModule.insert).toHaveBeenCalledWith(mockDb, doc);
            expect(result).toBe('new-id');
        });
    });

    describe('removeDoc', () => {
        it('should remove a document by id', async () => {
            const mockDb = { id: 'test-db' };
            mockOramaModule.remove.mockResolvedValue(undefined);
            vi.doMock('@orama/orama', () => mockOramaModule);

            const { removeDoc } = await import('../orama');
            await removeDoc(mockDb, 'doc-1');

            expect(mockOramaModule.remove).toHaveBeenCalledWith(mockDb, 'doc-1');
        });
    });

    describe('updateDoc', () => {
        it('should update a document', async () => {
            const mockDb = { id: 'test-db' };
            mockOramaModule.update.mockResolvedValue('doc-1');
            vi.doMock('@orama/orama', () => mockOramaModule);

            const { updateDoc } = await import('../orama');
            const doc = { title: 'Updated' };
            const result = await updateDoc(mockDb, 'doc-1', doc);

            expect(mockOramaModule.update).toHaveBeenCalledWith(
                mockDb,
                'doc-1',
                doc
            );
            expect(result).toBe('doc-1');
        });
    });
});

describe('model search lifecycle', () => {
    let scope: EffectScope;
    const client = process.client;
    const model = (id: string, description: string) => ({ id, name: id, description }) as OpenRouterModel;
    beforeEach(() => {
        vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
        process.client = true;
        vi.doMock('@orama/orama', () => mockOramaModule);
        mockOramaModule.create.mockResolvedValue({});
        mockOramaModule.insertMultiple.mockResolvedValue(undefined);
        mockOramaModule.search.mockResolvedValue({ hits: [] });
        scope = effectScope();
    });
    afterEach(() => { scope.stop(); process.client = client; vi.useRealTimers(); });
    it.each(['unavailable', 'failed'] as const)('lists and searches models when the optional index is %s', async failure => {
        if (failure === 'unavailable') mockOramaModule.create.mockResolvedValue(null);
        else mockOramaModule.create.mockRejectedValue(new Error('Index failed to load'));
        const { useModelSearch } = await import('../useModelSearch');
        const models = ref([model('first', 'amber capabilities'), model('second', 'cobalt capabilities')]);
        const search = scope.run(() => useModelSearch(models))!;
        await expect(search.rebuild()).resolves.toBeUndefined();
        search.query.value = 'amber'; await nextTick(); await vi.advanceTimersByTimeAsync(120);
        expect(search.results.value.map(model => model.id)).toEqual(['first']);
        search.query.value = ''; await nextTick(); await vi.advanceTimersByTimeAsync(120);
        expect(search.results.value.map(model => model.id)).toEqual(['first', 'second']);
    });
    // Live catalog: "gpt-6 luna" listed GPT-6 Luna Pro first because named
    // matches kept catalog order.
    it('lists the exact model before longer names that contain it', async () => {
        const { useModelSearch } = await import('../useModelSearch');
        const named = (id: string, name: string) => ({ id, name, description: '' }) as OpenRouterModel;
        const search = scope.run(() => useModelSearch(ref([
            named('openai/gpt-6-luna-pro', 'OpenAI: GPT-6 Luna Pro'),
            named('vendor/fast-gpt-6-luna', 'Vendor: Fast GPT-6 Luna'),
            named('openai/gpt-6-luna', 'OpenAI: GPT-6 Luna'),
            named('openai/gpt-6-luna-mini', 'OpenAI: GPT-6 Luna Mini'),
        ])))!;
        search.query.value = 'gpt-6 luna'; await nextTick(); await vi.advanceTimersByTimeAsync(120);
        expect(search.results.value.map(model => model.id)).toEqual([
            'openai/gpt-6-luna', 'openai/gpt-6-luna-pro', 'openai/gpt-6-luna-mini', 'vendor/fast-gpt-6-luna']);
    });
    it.each(['resolve', 'reject'] as const)('ignores an older search that %ss after the query is cleared', async completion => {
        let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
        const held = new Promise((res, rej) => { resolve = res; reject = rej; });
        mockOramaModule.search.mockReturnValue(held);
        const { useModelSearch } = await import('../useModelSearch');
        const search = scope.run(() => useModelSearch(ref([model('first', 'amber'), model('second', 'cobalt')])))!;
        await search.rebuild(); search.query.value = 'amber'; await nextTick(); await vi.advanceTimersByTimeAsync(120);
        expect(mockOramaModule.search).toHaveBeenCalled();
        search.query.value = ''; await nextTick(); await vi.advanceTimersByTimeAsync(120);
        expect(search.results.value).toHaveLength(2);
        if (completion === 'resolve') resolve({ hits: [{ id: 'first' }] }); else reject(new Error('Index unavailable'));
        await vi.advanceTimersByTimeAsync(0);
        expect(search.results.value.map(model => model.id)).toEqual(['first', 'second']);
    });
});
