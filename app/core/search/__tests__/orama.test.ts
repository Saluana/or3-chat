import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
