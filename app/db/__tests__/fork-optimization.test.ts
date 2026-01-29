import { beforeEach, describe, expect, it, vi } from 'vitest';

type TableRecord = Record<string, unknown>;

const dbState = vi.hoisted(() => {
    const putCounts = new Map<string, number>();
    const bulkPutCounts = new Map<string, number>();

    const createTable = (name: string, pk: string) => {
        const rows = new Map<string, TableRecord>();
        putCounts.set(name, 0);
        bulkPutCounts.set(name, 0);

        const table = {
            __rows: rows,
            __lastPut: null as TableRecord | null,
            async get(id: string) {
                return rows.get(id);
            },
            async put(row: TableRecord) {
                putCounts.set(name, (putCounts.get(name) || 0) + 1);
                const key = String(row[pk]);
                const stored = { ...row };
                rows.set(key, stored);
                table.__lastPut = stored;
            },
            async bulkPut(items: TableRecord[]) {
                bulkPutCounts.set(name, (bulkPutCounts.get(name) || 0) + 1);
                for (const item of items) {
                     const key = String(item[pk]);
                     rows.set(key, { ...item });
                }
            },
            async delete(id: string) {
                rows.delete(String(id));
            },
            where(field: string) {
                return {
                    equals(value: string) {
                        return {
                            async toArray() {
                                return Array.from(rows.values()).filter(r => r[field] === value);
                            },
                            sortBy(sortField: string) {
                                const items = Array.from(rows.values()).filter(r => r[field] === value);
                                return Promise.resolve(items.sort((a, b) => {
                                    const valA = a[sortField] as number;
                                    const valB = b[sortField] as number;
                                    return valA - valB;
                                }));
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
        threads: createTable('threads', 'id'),
        messages: createTable('messages', 'id'),
        // Add others to satisfy dependencies if any, though forkThread mainly touches these
        projects: createTable('projects', 'id'),
        posts: createTable('posts', 'id'),
        kv: createTable('kv', 'id'),
        file_meta: createTable('file_meta', 'hash'),
        attachments: createTable('attachments', 'id'),
        notifications: createTable('notifications', 'id'),
        file_transfers: createTable('file_transfers', 'id'),
        file_blobs: createTable('file_blobs', 'hash'),
        pending_ops: createTable('pending_ops', 'id'),
        tombstones: createTable('tombstones', 'id'),
        sync_state: createTable('sync_state', 'id'),
        sync_runs: createTable('sync_runs', 'id'),
    };

    const reset = () => {
        for (const [name, table] of Object.entries(tables)) {
            table.__rows.clear();
            table.__lastPut = null;
            putCounts.set(name, 0);
            bulkPutCounts.set(name, 0);
        }
    };

    return { tables, reset, putCounts, bulkPutCounts };
});

vi.mock('../client', () => {
    const db = {
        ...dbState.tables,
        async transaction(_mode: string, ...args: Array<unknown>) {
            const fn = args[args.length - 1];
            if (typeof fn === 'function') {
                await (fn as () => Promise<void>)();
            }
        },
    };
    return {
        db,
        getDb: () => db,
    };
});

vi.mock('../dbTry', () => ({
    dbTry: async <T>(fn: () => T | Promise<T>) => fn(),
}));

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async () => {},
    }),
}));

import { forkThread } from '../threads';

describe('forkThread optimization', () => {
    beforeEach(() => {
        dbState.reset();
    });

    it('measures put vs bulkPut calls during forkThread', async () => {
        const threadId = 'thread-1';

        // Setup source thread
        dbState.tables.threads.__rows.set(threadId, {
            id: threadId,
            title: 'Source Thread',
            created_at: 1000,
            updated_at: 1000,
            clock: 1,
            status: 'ready',
            deleted: false,
            pinned: false,
            forked: false,
            project_id: null,
            system_prompt_id: null,
            parent_thread_id: null,
            anchor_message_id: null,
            anchor_index: null,
            branch_mode: null,
            last_message_at: 1000,
        });

        // Setup messages
        const numMessages = 10;
        for (let i = 0; i < numMessages; i++) {
             dbState.tables.messages.__rows.set(`msg-${i}`, {
                id: `msg-${i}`,
                thread_id: threadId,
                index: i,
                role: 'user',
                created_at: 1000 + i,
                updated_at: 1000 + i,
                clock: i,
                deleted: false,
                data: null,
                error: null,
                stream_id: null,
                file_hashes: null,
             });
        }

        // Run forkThread
        await forkThread(threadId, { title: 'Forked Thread' }, { copyMessages: true });

        const messagePutCount = dbState.putCounts.get('messages');
        const messageBulkPutCount = dbState.bulkPutCounts.get('messages');

        console.log(`Message Puts: ${messagePutCount}, Message BulkPuts: ${messageBulkPutCount}`);

        // Current behavior (Unoptimized): Expect 1 put per message, 0 bulkPut
        // Optimized behavior: Expect 0 put per message, 1 bulkPut

        // Assert optimized behavior
        expect(messagePutCount).toBe(0);
        expect(messageBulkPutCount).toBe(1);
    });
});
