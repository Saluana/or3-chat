import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock errors FIRST before any other imports - mock both path variations
vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn((_code: string, _message: string, meta: any) => meta),
}));

vi.mock('../../utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn((_code: string, _message: string, meta: any) => meta),
}));

import type { DocumentRow } from '../documents';

// Minimal HookEngine stub for tests to avoid importing application hook engine
function createTestHookEngine() {
    const filters = new Map<string, Function[]>();
    const actions = new Map<string, Function[]>();

    return {
        addFilter(name: string, fn: Function) {
            const arr = filters.get(name) || [];
            arr.push(fn);
            filters.set(name, arr);
        },
        addAction(name: string, fn: Function) {
            const arr = actions.get(name) || [];
            arr.push(fn);
            actions.set(name, arr);
        },
        async applyFilters<T>(name: string, value: T, ...args: any[]) {
            const arr = filters.get(name) || [];
            let v: any = value;
            for (const f of arr) {
                // Support sync/async filters
                const res = await f(v, ...args);
                if (res !== undefined) v = res;
            }
            return v as T;
        },
        async doAction(name: string, ...args: any[]) {
            const arr = actions.get(name) || [];
            for (const f of arr) {
                try {
                    await f(...args);
                } catch {}
            }
        },
        removeAllCallbacks() {
            filters.clear();
            actions.clear();
        },
        // diagnostics helpers (minimal)
        hasFilter() {
            return false;
        },
    } as any;
}

const hookEngine = createTestHookEngine();

// Mock Nuxt app
vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));

// Hoisted table state
const tableState = vi.hoisted(() => {
    const rows = new Map<string, any>();
    return {
        rows,
        clear() {
            rows.clear();
        },
        clone<T>(value: T): T {
            return JSON.parse(JSON.stringify(value));
        },
    };
});

// Mock DB client
vi.mock('../client', () => {
    const state = tableState;
    const posts = {
        __rows: state.rows,
        __clear: () => state.clear(),
        __clone: (value: any) => state.clone(value),
        async put(row: any) {
            state.rows.set(row.id, state.clone(row));
            return row.id;
        },
        async get(id: string) {
            const value = state.rows.get(id);
            return value ? state.clone(value) : undefined;
        },
        isOpen: () => true,
    };
    const db = { posts, isOpen: () => true };
    return {
        db,
        getDb: () => db,
    };
});

// Mock dbTry to pass through
vi.mock('../dbTry', () => ({
    dbTry: vi.fn(async (fn: () => any) => fn()),
}));

// Mock util functions
vi.mock('../util', () => ({
    newId: vi.fn(
        () => `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`
    ),
    nowSec: vi.fn(() => Math.floor(Date.now() / 1000)),
    nextClock: vi.fn((clock?: number) => (clock ?? 0) + 1),
}));

import { createDocument, updateDocument } from '../documents';
import { db } from '../client';
import { newId, nowSec } from '../util';

const postsTable = db.posts as any;
const newIdMock = vi.mocked(newId);
const nowSecMock = vi.mocked(nowSec);

describe('document hooks integration', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
        postsTable.__clear();
        newIdMock.mockClear();
        nowSecMock.mockClear();

        // Set up default mock implementations
        let idCounter = 0;
        newIdMock.mockImplementation(() => `doc-${++idCounter}`);
        nowSecMock.mockReturnValue(1000);
    });

    it('createDocument applies title filter and fires hooks in order', async () => {
        const events: string[] = [];
        const contexts: any[] = [];

        hookEngine.addFilter(
            'db.documents.title:filter',
            (title: string, ctx: any) => {
                events.push(`title:${ctx.phase}`);
                contexts.push({ title, ctx });
                return title.toUpperCase();
            }
        );

        hookEngine.addFilter(
            'db.documents.create:filter:input',
            (row: DocumentRow) => {
                events.push('create:filter');
                expect(row.title).toBe('HELLO WORLD');
                row.content = JSON.stringify({
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [] }],
                });
                return row;
            }
        );

        hookEngine.addAction('db.documents.create:action:before', () => {
            events.push('create:before');
        });

        hookEngine.addAction('db.documents.create:action:after', () => {
            events.push('create:after');
        });

        const document = await createDocument({
            title: '  hello world  ',
            content: { type: 'doc', content: [] },
        });

        expect(document.title).toBe('HELLO WORLD');
        expect(document.content).toEqual({
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
        });

        expect(events).toEqual([
            'title:create',
            'create:filter',
            'create:before',
            'create:after',
        ]);

        expect(contexts).toHaveLength(1);
        expect(contexts[0]!.ctx.id).toBe(document.id);
        expect(contexts[0]!.ctx.phase).toBe('create');

        const stored = (await postsTable.get(document.id)) as DocumentRow;
        expect(stored.title).toBe('HELLO WORLD');
        expect(JSON.parse(stored.content)).toEqual({
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
        });
    });

    it('updateDocument applies title filter and allows content transform', async () => {
        const existing: DocumentRow = {
            id: 'doc-1',
            title: 'Original Title',
            content: JSON.stringify({ type: 'doc', content: [] }),
            postType: 'doc',
            created_at: 10,
            updated_at: 10,
            deleted: false,
        };
        postsTable.__rows.set(existing.id, postsTable.__clone(existing));

        const events: string[] = [];
        const seenContexts: any[] = [];

        hookEngine.addFilter(
            'db.documents.title:filter',
            (title: string, ctx: any) => {
                events.push(`title:${ctx.phase}`);
                seenContexts.push(ctx);
                return `${title}!`.toUpperCase();
            }
        );

        hookEngine.addFilter(
            'db.documents.update:filter:input',
            ({ existing: prev, updated, patch }: any) => {
                events.push('update:filter');
                expect(prev.id).toBe('doc-1');
                expect(updated.title).toBe('PATCHED TITLE!');
                updated.content = JSON.stringify({
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'filtered' }],
                        },
                    ],
                });
                return { existing: prev, updated, patch };
            }
        );

        hookEngine.addAction(
            'db.documents.update:action:before',
            (row: any) => {
                events.push('update:before');
                const parsed = JSON.parse(row.content);
                expect(parsed.content[0]?.content?.[0]?.text).toBe('filtered');
            }
        );

        hookEngine.addAction('db.documents.update:action:after', () => {
            events.push('update:after');
        });

        const result = await updateDocument('doc-1', {
            title: ' patched title ',
            content: { type: 'doc', content: [] },
        });

        expect(result).toBeDefined();
        expect(result!.title).toBe('PATCHED TITLE!');
        expect(result!.content).toEqual({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'filtered' }],
                },
            ],
        });

        expect(events).toEqual([
            'title:update',
            'update:filter',
            'update:before',
            'update:after',
        ]);

        expect(seenContexts).toHaveLength(1);
        expect(seenContexts[0]!.id).toBe('doc-1');
        expect(seenContexts[0]!.existing.id).toBe('doc-1');

        const stored = (await postsTable.get('doc-1')) as DocumentRow;
        expect(stored.title).toBe('PATCHED TITLE!');
        expect(JSON.parse(stored.content)).toEqual({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'filtered' }],
                },
            ],
        });
    });

    it('title filter receives correct context on create', async () => {
        let capturedContext: any = null;

        hookEngine.addFilter(
            'db.documents.title:filter',
            (title: string, ctx: any) => {
                capturedContext = ctx;
                return title;
            }
        );

        const doc = await createDocument({ title: 'Test' });

        expect(capturedContext).toBeDefined();
        expect(capturedContext.phase).toBe('create');
        expect(capturedContext.id).toBe(doc.id);
        expect(capturedContext.rawTitle).toBe('Test');
        expect(capturedContext.existing).toBeUndefined();
    });

    it('title filter receives correct context on update', async () => {
        const existing: DocumentRow = {
            id: 'doc-update',
            title: 'Old',
            content: '{}',
            postType: 'doc',
            created_at: 10,
            updated_at: 10,
            deleted: false,
        };
        postsTable.__rows.set(existing.id, postsTable.__clone(existing));

        let capturedContext: any = null;

        hookEngine.addFilter(
            'db.documents.title:filter',
            (title: string, ctx: any) => {
                capturedContext = ctx;
                return title;
            }
        );

        await updateDocument('doc-update', { title: 'New' });

        expect(capturedContext).toBeDefined();
        expect(capturedContext.phase).toBe('update');
        expect(capturedContext.id).toBe('doc-update');
        expect(capturedContext.rawTitle).toBe('New');
        expect(capturedContext.existing).toBeDefined();
        expect(capturedContext.existing.id).toBe('doc-update');
    });
});
