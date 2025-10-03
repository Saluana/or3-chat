import Dexie from 'dexie';
import { db } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../composables/useHooks';
import { newId, nowSec, parseOrThrow } from './util';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';
import { serializeFileHashes } from './files-util';

export async function createMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.messages.create:filter:input',
        input as any
    );
    // Support passing file_hashes as string[] for convenience
    if (Array.isArray((filtered as any).file_hashes)) {
        (filtered as any).file_hashes = serializeFileHashes(
            (filtered as any).file_hashes
        );
    }
    // Apply defaults (id/clock/timestamps) then validate fully
    const prepared = parseOrThrow(MessageCreateSchema, filtered);
    const value = parseOrThrow(MessageSchema, prepared);
    await hooks.doAction('db.messages.create:action:before', {
        entity: value as any,
        tableName: 'messages',
    });
    await dbTry(
        () => db.messages.put(value),
        { op: 'write', entity: 'messages', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.messages.create:action:after', {
        entity: value as any,
        tableName: 'messages',
    });
    return value;
}

export async function upsertMessage(value: Message): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        value as any
    );
    await hooks.doAction('db.messages.upsert:action:before', {
        entity: filtered as any,
        tableName: 'messages',
    });
    parseOrThrow(MessageSchema, filtered);
    await dbTry(
        () => db.messages.put(filtered as any),
        { op: 'write', entity: 'messages', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.messages.upsert:action:after', {
        entity: filtered as any,
        tableName: 'messages',
    });
}

export function messagesByThread(threadId: string) {
    const hooks = useHooks();
    return dbTry(
        () => db.messages.where('thread_id').equals(threadId).sortBy('index'),
        { op: 'read', entity: 'messages', action: 'byThread' }
    )?.then((res) =>
        hooks.applyFilters('db.messages.byThread:filter:output', res as any)
    );
}

export function getMessage(id: string) {
    const hooks = useHooks();
    return dbTry(() => db.messages.get(id), {
        op: 'read',
        entity: 'messages',
        action: 'get',
    })?.then((res) =>
        res
            ? hooks.applyFilters('db.messages.get:filter:output', res as any)
            : undefined
    );
}

export function messageByStream(streamId: string) {
    const hooks = useHooks();
    return dbTry(
        () => db.messages.where('stream_id').equals(streamId).first(),
        { op: 'read', entity: 'messages', action: 'byStream' }
    )?.then((res) =>
        hooks.applyFilters('db.messages.byStream:filter:output', res as any)
    );
}

export async function softDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, async () => {
        const m = await dbTry(() => db.messages.get(id), {
            op: 'read',
            entity: 'messages',
            action: 'get',
        });
        if (!m) return;
        await hooks.doAction('db.messages.delete:action:soft:before', {
            entity: m as any,
            id: m.id,
            tableName: 'messages',
        });
        await dbTry(
            () =>
                db.messages.put({ ...m, deleted: true, updated_at: nowSec() }),
            { op: 'write', entity: 'messages', action: 'softDelete' }
        );
        await hooks.doAction('db.messages.delete:action:soft:after', {
            entity: m as any,
            id: m.id,
            tableName: 'messages',
        });
    });
}

export async function hardDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.messages.get(id), {
        op: 'read',
        entity: 'messages',
        action: 'get',
    });
    await hooks.doAction('db.messages.delete:action:hard:before', {
        entity: existing! as any,
        id,
        tableName: 'messages',
    });
    await dbTry(() => db.messages.delete(id), {
        op: 'write',
        entity: 'messages',
        action: 'hardDelete',
    });
    await hooks.doAction('db.messages.delete:action:hard:after', {
        entity: existing! as any,
        id,
        tableName: 'messages',
    });
}

// Append a message to a thread and update thread timestamps atomically
export async function appendMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    return db.transaction('rw', db.messages, db.threads, async () => {
        if (Array.isArray((input as any).file_hashes)) {
            (input as any).file_hashes = serializeFileHashes(
                (input as any).file_hashes
            );
        }
        const value = parseOrThrow(MessageCreateSchema, input);
        await hooks.doAction('db.messages.append:action:before', value);
        // If index not set, compute next sparse index in thread
        if (value.index === undefined || value.index === null) {
            const last = await db.messages
                .where('[thread_id+index]')
                .between(
                    [value.thread_id, Dexie.minKey],
                    [value.thread_id, Dexie.maxKey]
                )
                .last();
            const lastIdx = last?.index ?? 0;
            value.index = last ? lastIdx + 1000 : 1000;
        }
        const finalized = parseOrThrow(MessageSchema, value);
        await db.messages.put(finalized);
        const t = await db.threads.get(value.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        await hooks.doAction('db.messages.append:action:after', finalized);
        return finalized;
    });
}

// Move a message to another thread, computing next index in destination
export async function moveMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.move:action:before', {
            message: m,
            toThreadId,
        });
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await db.messages.put({
            ...m,
            thread_id: toThreadId,
            index: nextIdx,
            updated_at: nowSec(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        await hooks.doAction('db.messages.move:action:after', {
            messageId,
            toThreadId,
        });
    });
}

// Copy a message into another thread (new id) and update dest thread timestamps
export async function copyMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.copy:action:before', {
            message: m,
            toThreadId,
        });
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await db.messages.put({
            ...m,
            id: newId(),
            thread_id: toThreadId,
            index: nextIdx,
            created_at: nowSec(),
            updated_at: nowSec(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        await hooks.doAction('db.messages.copy:action:after', {
            from: messageId,
            toThreadId,
        });
    });
}

// Insert a message right after a given message id, adjusting index using sparse spacing
export async function insertMessageAfter(
    afterMessageId: string,
    input: Omit<MessageCreate, 'index'>
): Promise<Message> {
    const hooks = useHooks();
    return db.transaction('rw', db.messages, db.threads, async () => {
        const after = await db.messages.get(afterMessageId);
        if (!after) throw new Error('after message not found');
        const next = await db.messages
            .where('[thread_id+index]')
            .above([after.thread_id, after.index])
            .first();
        let newIndex: number;
        if (!next) {
            newIndex = after.index + 1000;
        } else if (next.index - after.index > 1) {
            newIndex = after.index + Math.floor((next.index - after.index) / 2);
        } else {
            // No gap, normalize thread then place after
            await normalizeThreadIndexes(after.thread_id);
            newIndex = after.index + 1000;
        }
        if (Array.isArray((input as any).file_hashes)) {
            (input as any).file_hashes = serializeFileHashes(
                (input as any).file_hashes
            );
        }
        const value = parseOrThrow(MessageCreateSchema, {
            ...input,
            index: newIndex,
            thread_id: after.thread_id,
        });
        await hooks.doAction('db.messages.insertAfter:action:before', {
            after,
            value,
        });
        const finalized = parseOrThrow(MessageSchema, value);
        await db.messages.put(finalized);
        const t = await db.threads.get(after.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        await hooks.doAction('db.messages.insertAfter:action:after', finalized);
        return finalized;
    });
}

// Compact / normalize indexes for a thread to 1000, 2000, 3000...
export async function normalizeThreadIndexes(
    threadId: string,
    start = 1000,
    step = 1000
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, async () => {
        await hooks.doAction('db.messages.normalize:action:before', {
            threadId,
            start,
            step,
        });
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
            .toArray();
        msgs.sort((a, b) => a.index - b.index);
        let idx = start;
        for (const m of msgs) {
            if (m.index !== idx) {
                await db.messages.put({
                    ...m,
                    index: idx,
                    updated_at: nowSec(),
                });
            }
            idx += step;
        }
        await hooks.doAction('db.messages.normalize:action:after', {
            threadId,
        });
    });
}
