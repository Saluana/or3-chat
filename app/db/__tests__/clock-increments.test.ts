import { beforeEach, describe, expect, it, vi } from 'vitest';

type TableRecord = Record<string, unknown>;

const dbState = vi.hoisted(() => {
    const createTable = (pk: string) => {
        const rows = new Map<string, TableRecord>();
        const table = {
            __rows: rows,
            __lastPut: null as TableRecord | null,
            async get(id: string) {
                return rows.get(id);
            },
            async put(row: TableRecord) {
                const key = String(row[pk]);
                const stored = { ...row };
                rows.set(key, stored);
                table.__lastPut = stored;
            },
            async delete(id: string) {
                rows.delete(String(id));
            },
            where(_field: string) {
                return {
                    equals(_value: string) {
                        return {
                            async toArray() {
                                return [];
                            },
                            async first() {
                                return undefined;
                            },
                            async delete() {
                                return 0;
                            },
                        };
                    },
                };
            },
        };
        return table;
    };

    const tables = {
        threads: createTable('id'),
        messages: createTable('id'),
        projects: createTable('id'),
        posts: createTable('id'),
        kv: createTable('id'),
        file_meta: createTable('hash'),
    };

    const reset = () => {
        for (const table of Object.values(tables)) {
            table.__rows.clear();
            table.__lastPut = null;
        }
    };

    return { tables, reset };
});

vi.mock('../client', () => ({
    db: {
        ...dbState.tables,
        async transaction(_mode: string, ...args: Array<unknown>) {
            const fn = args[args.length - 1];
            if (typeof fn === 'function') {
                await (fn as () => Promise<void>)();
            }
        },
    },
}));

vi.mock('../dbTry', () => ({
    dbTry: async <T>(fn: () => T | Promise<T>) => fn(),
}));

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async () => {},
    }),
}));

import { createThread, softDeleteThread, upsertThread } from '../threads';
import { createMessage, softDeleteMessage, upsertMessage } from '../messages';
import { createProject, softDeleteProject, upsertProject } from '../projects';
import { createPost, softDeletePost, upsertPost } from '../posts';
import { createKv, upsertKv } from '../kv';
import { updateFileName } from '../files-select';

const baseThread = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'thread-1',
    title: 'Thread',
    created_at: 1,
    updated_at: 1,
    last_message_at: null,
    parent_thread_id: null,
    anchor_message_id: null,
    anchor_index: null,
    branch_mode: null,
    status: 'ready',
    deleted: false,
    pinned: false,
    clock: 0,
    forked: false,
    project_id: null,
    system_prompt_id: null,
    ...overrides,
});

const baseMessage = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'msg-1',
    data: null,
    role: 'user',
    pending: false,
    created_at: 1,
    updated_at: 1,
    error: null,
    deleted: false,
    thread_id: 'thread-1',
    index: 0,
    order_key: '0000000000001:0000:node',
    clock: 0,
    stream_id: null,
    file_hashes: null,
    ...overrides,
});

const baseProject = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'project-1',
    name: 'Project',
    description: null,
    data: [],
    created_at: 1,
    updated_at: 1,
    deleted: false,
    clock: 0,
    ...overrides,
});

const basePost = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'post-1',
    title: 'Post',
    content: '',
    postType: 'markdown',
    created_at: 1,
    updated_at: 1,
    deleted: false,
    clock: 0,
    meta: '',
    file_hashes: null,
    ...overrides,
});

describe('clock increments on write paths', () => {
    beforeEach(() => {
        dbState.reset();
    });

    it('increments clock on thread create/update/delete', async () => {
        await createThread({ title: 'Thread' });
        expect(dbState.tables.threads.__lastPut?.clock).toBe(1);

        dbState.tables.threads.__rows.set('thread-1', baseThread({ clock: 5 }));
        await upsertThread(baseThread({ clock: 5 }));
        expect(dbState.tables.threads.__lastPut?.clock).toBe(6);

        await softDeleteThread('thread-1');
        expect(dbState.tables.threads.__lastPut?.clock).toBe(7);
        expect(dbState.tables.threads.__lastPut?.deleted).toBe(true);
    });

    it('increments clock on message create/update/delete', async () => {
        await createMessage({
            thread_id: 'thread-1',
            role: 'user',
            index: 0,
        });
        expect(dbState.tables.messages.__lastPut?.clock).toBe(1);

        dbState.tables.messages.__rows.set('msg-1', baseMessage({ clock: 3 }));
        await upsertMessage(baseMessage({ clock: 3 }) as any);
        expect(dbState.tables.messages.__lastPut?.clock).toBe(4);

        await softDeleteMessage('msg-1');
        expect(dbState.tables.messages.__lastPut?.clock).toBe(5);
        expect(dbState.tables.messages.__lastPut?.deleted).toBe(true);
    });

    it('increments clock on project create/update/delete', async () => {
        await createProject(baseProject({ clock: 0 }) as any);
        expect(dbState.tables.projects.__lastPut?.clock).toBe(1);

        dbState.tables.projects.__rows.set(
            'project-1',
            baseProject({ clock: 2 })
        );
        await upsertProject(baseProject({ clock: 2 }) as any);
        expect(dbState.tables.projects.__lastPut?.clock).toBe(3);

        await softDeleteProject('project-1');
        expect(dbState.tables.projects.__lastPut?.clock).toBe(4);
        expect(dbState.tables.projects.__lastPut?.deleted).toBe(true);
    });

    it('increments clock on post create/update/delete', async () => {
        await createPost({
            title: 'Post',
            content: '',
            postType: 'markdown',
            meta: '',
        });
        expect(dbState.tables.posts.__lastPut?.clock).toBe(1);

        dbState.tables.posts.__rows.set('post-1', basePost({ clock: 7 }));
        await upsertPost(basePost({ clock: 7 }) as any);
        expect(dbState.tables.posts.__lastPut?.clock).toBe(8);

        await softDeletePost('post-1');
        expect(dbState.tables.posts.__lastPut?.clock).toBe(9);
        expect(dbState.tables.posts.__lastPut?.deleted).toBe(true);
    });

    it('increments clock on kv create/update', async () => {
        await createKv({
            id: 'kv-1',
            name: 'test',
            value: 'value',
            deleted: false,
            clock: 0,
            created_at: 1,
            updated_at: 1,
        });
        expect(dbState.tables.kv.__lastPut?.clock).toBe(1);

        dbState.tables.kv.__rows.set('kv-1', {
            id: 'kv-1',
            name: 'test',
            value: 'value',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 4,
        });
        await upsertKv({
            id: 'kv-1',
            name: 'test',
            value: 'value',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 4,
        });
        expect(dbState.tables.kv.__lastPut?.clock).toBe(5);
    });

    it('increments clock on file_meta updates', async () => {
        dbState.tables.file_meta.__rows.set('hash-1', {
            hash: 'hash-1',
            name: 'File',
            mime_type: 'image/png',
            kind: 'image',
            size_bytes: 1,
            width: 1,
            height: 1,
            ref_count: 1,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 2,
        });

        await updateFileName('hash-1', 'File Updated');
        expect(dbState.tables.file_meta.__lastPut?.clock).toBe(3);
        expect(dbState.tables.file_meta.__lastPut?.name).toBe('File Updated');
    });
});
