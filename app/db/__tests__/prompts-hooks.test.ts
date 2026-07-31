import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptRow } from '../prompts';

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
                } catch {
                    /* intentionally empty */
                }
            }
        },
        removeAllCallbacks() {
            filters.clear();
            actions.clear();
        },
    } as any;
}

const hookEngine = createTestHookEngine();
vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));

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

vi.mock('../client', () => {
    const state = tableState;
    const posts = {
        __rows: state.rows,
        __clear: () => state.clear(),
        async put(row: any) {
            state.rows.set(row.id, state.clone(row));
            return row.id;
        },
        async get(id: string) {
            const value = state.rows.get(id);
            return value ? state.clone(value) : undefined;
        },
    };
    const db = { posts, isOpen: () => true };
    return { db, getDb: () => db };
});

vi.mock('../util', () => ({
    newId: vi.fn(() => 'prompt-1'),
    nowSec: vi.fn(() => 1000),
    nextClock: vi.fn((clock?: number) => (clock ?? 0) + 1),
    getWriteTxTableNames: vi.fn(
        (
            db: { tables?: Array<{ name: string }> },
            primary: string | string[]
        ) => {
            const names = Array.isArray(primary) ? primary : [primary];
            const hasPendingOps = (db.tables ?? []).some(
                (table) => table.name === 'pending_ops'
            );
            return hasPendingOps ? [...names, 'pending_ops'] : names;
        }
    ),
}));

import {
    createPrompt,
    getPrompt,
    normalizePromptTags,
    parsePromptMeta,
    updatePrompt,
} from '../prompts';
import { db } from '../client';

const postsTable = db.posts as any;

describe('prompt hooks integration', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
        postsTable.__clear();
    });

    it('createPrompt works without db.transaction and applies filters', async () => {
        hookEngine.addFilter(
            'db.prompts.create:filter:input',
            (entity: { name: string; text: string }) => ({
                ...entity,
                name: `filtered:${entity.name}`,
            })
        );

        const created = await createPrompt({
            title: 'hello',
            content: { type: 'doc', content: [] },
        });

        expect(created.title).toBe('filtered:hello');
        const stored = (await postsTable.get(created.id)) as PromptRow;
        expect(stored).toBeDefined();
        expect(stored.title).toBe('filtered:hello');
    });

    it('updatePrompt works without db.transaction and persists updates', async () => {
        postsTable.__rows.set('prompt-1', {
            id: 'prompt-1',
            title: 'old',
            content: JSON.stringify({ type: 'doc', content: [] }),
            postType: 'prompt',
            created_at: 1000,
            updated_at: 1000,
            deleted: false,
            meta: JSON.stringify({
                tags: ['Writing'],
                favorite: true,
            }),
            clock: 1,
        });

        const updated = await updatePrompt('prompt-1', {
            title: 'new title',
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [] }],
            },
        });

        expect(updated).toBeDefined();
        expect(updated!.title).toBe('new title');
        const stored = (await postsTable.get('prompt-1')) as PromptRow;
        expect(stored.title).toBe('new title');
        expect(parsePromptMeta(stored.meta)).toEqual({
            tags: ['Writing'],
            favorite: true,
        });
    });

    it('normalizes prompt tags and persists favorite metadata', async () => {
        const created = await createPrompt({
            title: 'Tagged',
            tags: [' Writing ', 'writing', '', 'Research'],
            favorite: true,
        });

        expect(created.tags).toEqual(['Writing', 'Research']);
        expect(created.favorite).toBe(true);
        expect(normalizePromptTags(['One', ' one ', 2, null])).toEqual([
            'One',
        ]);
    });

    it('defaults invalid legacy metadata without losing prompt content', async () => {
        postsTable.__rows.set('legacy-prompt', {
            id: 'legacy-prompt',
            title: 'Legacy',
            content: JSON.stringify({
                type: 'doc',
                content: [{ type: 'paragraph', content: [] }],
            }),
            postType: 'prompt',
            created_at: 1000,
            updated_at: 1000,
            deleted: false,
            meta: 'not-json',
            clock: 1,
        });

        const prompt = await getPrompt('legacy-prompt');

        expect(prompt).toMatchObject({
            title: 'Legacy',
            tags: [],
            favorite: false,
        });
        expect(prompt?.content?.type).toBe('doc');
    });

    it('normalizes metadata patches and preserves them during later autosaves', async () => {
        postsTable.__rows.set('prompt-1', {
            id: 'prompt-1',
            title: 'Prompt',
            content: JSON.stringify({ type: 'doc', content: [] }),
            postType: 'prompt',
            created_at: 1000,
            updated_at: 1000,
            deleted: false,
            meta: '',
            clock: 1,
        });

        await updatePrompt('prompt-1', {
            tags: [' Coding ', 'coding', 'Review'],
            favorite: true,
        });
        const autosaved = await updatePrompt('prompt-1', {
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [] }],
            },
        });

        expect(autosaved).toMatchObject({
            tags: ['Coding', 'Review'],
            favorite: true,
        });
    });
});
