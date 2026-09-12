import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, Thread } from '../schema';

const testState = vi.hoisted(() => ({
    db: null as import('../client').Or3DB | null,
    doAction: vi.fn(),
}));

vi.mock('../client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../client')>();
    return {
        ...actual,
        getDb: () => {
            if (!testState.db) throw new Error('Test database is not initialized');
            return testState.db;
        },
    };
});

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: testState.doAction,
    }),
}));

import { Or3DB } from '../client';
import {
    appendMessage,
    copyMessage,
    insertMessageAfter,
    messagesByThread,
    moveMessage,
    normalizeThreadIndexes,
    patchMessageInDb,
} from '../messages';

let databaseSequence = 0;

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
    return {
        id,
        title: id,
        created_at: 100,
        updated_at: 100,
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
    };
}

function makeMessage(
    id: string,
    threadId: string,
    index: number,
    overrides: Partial<Message> = {}
): Message {
    return {
        id,
        thread_id: threadId,
        role: 'user',
        data: { content: id },
        index,
        order_key: `order-${id}`,
        created_at: 100,
        updated_at: 100,
        deleted: false,
        clock: 0,
        ...overrides,
    };
}

describe('message transaction and ordering contracts', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        testState.doAction.mockReset();
        testState.doAction.mockResolvedValue(undefined);
        testState.db = new Or3DB(`or3-messages-test-${databaseSequence++}`);
        await testState.db.open();
    });

    afterEach(async () => {
        vi.useRealTimers();
        const db = testState.db;
        testState.db = null;
        if (db) {
            db.close();
            await db.delete();
        }
    });

    it('appends with sparse indexes, serializes file hashes, and updates the thread atomically', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1', { clock: 4 }));

        const first = await appendMessage({
            id: 'message-1',
            thread_id: 'thread-1',
            role: 'user',
            file_hashes: ['hash-a', 'hash-b'] as unknown as string,
        });
        const second = await appendMessage({
            id: 'message-2',
            thread_id: 'thread-1',
            role: 'assistant',
        });

        expect(first).toMatchObject({
            id: 'message-1',
            index: 1000,
            clock: 1,
            file_hashes: JSON.stringify(['hash-a', 'hash-b']),
        });
        expect(second.index).toBe(2000);
        expect((await db.threads.get('thread-1'))).toMatchObject({
            last_message_at: 1767323045,
            updated_at: 1767323045,
            clock: 6,
        });
        expect(testState.doAction).toHaveBeenCalledWith(
            'db.messages.append:action:after',
            expect.objectContaining({ id: 'message-2', index: 2000 })
        );
    });

    it('moves a message and copies another to the next destination indexes', async () => {
        const db = testState.db!;
        await db.threads.bulkPut([
            makeThread('source'),
            makeThread('destination', { clock: 10 }),
        ]);
        await db.messages.bulkPut([
            makeMessage('source-move', 'source', 1000),
            makeMessage('source-copy', 'source', 2000, {
                data: { content: 'preserved' },
            }),
            makeMessage('destination-existing', 'destination', 3000),
        ]);

        await moveMessage('source-move', 'destination');
        await copyMessage('source-copy', 'destination');

        const moved = await db.messages.get('source-move');
        expect(moved).toMatchObject({
            thread_id: 'destination',
            index: 4000,
            clock: 1,
        });

        const destinationRows = await db.messages
            .where('thread_id')
            .equals('destination')
            .toArray();
        const copied = destinationRows.find(
            (message) =>
                message.id !== 'source-move' &&
                message.id !== 'destination-existing'
        );
        expect(copied).toMatchObject({
            thread_id: 'destination',
            index: 5000,
            data: { content: 'preserved' },
            clock: 1,
        });
        expect(copied?.id).not.toBe('source-copy');
        expect(await db.messages.get('source-copy')).toBeDefined();
        expect(await db.threads.get('destination')).toMatchObject({
            last_message_at: 1767323045,
            clock: 12,
        });
    });

    it('inserts at a midpoint without rewriting existing sparse indexes', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        await db.messages.bulkPut([
            makeMessage('before', 'thread-1', 1000),
            makeMessage('after', 'thread-1', 2000),
        ]);

        const inserted = await insertMessageAfter('before', {
            id: 'inserted',
            thread_id: 'ignored-by-api',
            role: 'assistant',
        });

        expect(inserted).toMatchObject({
            id: 'inserted',
            thread_id: 'thread-1',
            index: 1500,
        });
        expect((await db.messages.get('before'))?.index).toBe(1000);
        expect((await db.messages.get('after'))?.index).toBe(2000);
    });

    it('normalizes adjacent indexes before inserting and preserves their order', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        await db.messages.bulkPut([
            makeMessage('first', 'thread-1', 10),
            makeMessage('second', 'thread-1', 11),
            makeMessage('third', 'thread-1', 12),
        ]);

        const inserted = await insertMessageAfter('first', {
            id: 'inserted',
            thread_id: 'thread-1',
            role: 'assistant',
        });

        expect(inserted.index).toBe(1500);
        const rows = await db.messages
            .where('thread_id')
            .equals('thread-1')
            .toArray();
        rows.sort((a, b) => a.index - b.index);
        expect(rows.map(({ id, index }) => [id, index])).toEqual([
            ['first', 1000],
            ['inserted', 1500],
            ['second', 2000],
            ['third', 3000],
        ]);
    });

    it('normalizes with custom spacing and skips already normalized rows', async () => {
        const db = testState.db!;
        await db.messages.bulkPut([
            makeMessage('first', 'thread-1', 50, { clock: 2 }),
            makeMessage('second', 'thread-1', 75, { clock: 3 }),
            makeMessage('third', 'thread-1', 100, { clock: 4 }),
        ]);

        await normalizeThreadIndexes('thread-1', 50, 50);

        expect(await db.messages.get('first')).toMatchObject({
            index: 50,
            clock: 2,
            updated_at: 100,
        });
        expect(await db.messages.get('second')).toMatchObject({
            index: 100,
            clock: 4,
            updated_at: 1767323045,
        });
        expect(await db.messages.get('third')).toMatchObject({
            index: 150,
            clock: 5,
            updated_at: 1767323045,
        });
    });

    it('insertMessageAfter ignores other threads when the anchor is last', async () => {
        const db = testState.db!;
        // Dexie compound-index order interleaves thread b between thread a rows
        // unless the neighbor query is bounded to the anchor thread.
        await db.threads.bulkPut([makeThread('thread-a'), makeThread('thread-b')]);
        await db.messages.bulkPut([
            makeMessage('a-1', 'thread-a', 1000),
            makeMessage('a-2', 'thread-a', 2000),
            makeMessage('a-3', 'thread-a', 3000),
            makeMessage('b-1', 'thread-b', 1000),
        ]);
        const inserted = await insertMessageAfter('a-3', {
            id: 'a-4',
            thread_id: 'thread-a',
            role: 'assistant',
        } as any);

        expect(inserted.thread_id).toBe('thread-a');
        expect(inserted.index).toBe(4000);
        expect(inserted.index).toBeGreaterThan(3000);
    });

    it('orders index collisions deterministically by order key and then id', async () => {
        const db = testState.db!;
        await db.messages.bulkPut([
            makeMessage('z-id', 'thread-1', 1000, { order_key: 'a' }),
            makeMessage('a-id', 'thread-1', 1000, { order_key: 'a' }),
            makeMessage('middle', 'thread-1', 1000, { order_key: 'b' }),
            makeMessage('last-index', 'thread-1', 2000, {
                order_key: '0',
            }),
        ]);

        const ordered = (await messagesByThread('thread-1')) as Message[];

        expect(ordered.map((message) => message.id)).toEqual([
            'a-id',
            'z-id',
            'middle',
            'last-index',
        ]);
    });

    it('patchMessageInDb merges deltas atomically without dropping concurrent keys', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        await db.messages.put(
            makeMessage('msg-1', 'thread-1', 1000, {
                data: {
                    content: 'concurrent edit',
                    plugin_initial: true,
                    plugin_concurrent: { keep: true },
                },
                file_hashes: '["concurrent-file"]',
                clock: 5,
            })
        );

        // Delta built from stale state (no concurrent keys) must not erase them.
        await patchMessageInDb(db, 'msg-1', {
            data: { reasoning_text: 'new reasoning', tool_calls: [] },
        } as any);

        const row = await db.messages.get('msg-1');
        expect(row).toMatchObject({
            clock: 6,
            file_hashes: '["concurrent-file"]',
            data: {
                content: 'concurrent edit',
                plugin_initial: true,
                plugin_concurrent: { keep: true },
                reasoning_text: 'new reasoning',
                tool_calls: [],
            },
        });
    });

    it('rolls back both message and thread writes when an in-transaction hook fails', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1', { clock: 8 }));
        testState.doAction.mockImplementation(async (name: string) => {
            if (name === 'db.messages.append:action:after') {
                throw new Error('forced hook failure');
            }
        });

        await expect(
            appendMessage({
                id: 'rolled-back',
                thread_id: 'thread-1',
                role: 'user',
            })
        ).rejects.toThrow('forced hook failure');

        expect(await db.messages.get('rolled-back')).toBeUndefined();
        expect(await db.threads.get('thread-1')).toEqual(
            makeThread('thread-1', { clock: 8 })
        );
    });
});
