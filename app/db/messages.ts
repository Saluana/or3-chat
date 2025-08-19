import Dexie from 'dexie';
import { db } from './client';
import { newId, nowSec, parseOrThrow } from './util';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';

export async function createMessage(input: MessageCreate): Promise<Message> {
    const value = parseOrThrow(MessageCreateSchema, input);
    await db.messages.put(value);
    return value;
}

export async function upsertMessage(value: Message): Promise<void> {
    parseOrThrow(MessageSchema, value);
    await db.messages.put(value);
}

export function messagesByThread(threadId: string) {
    return db.messages.where('thread_id').equals(threadId).sortBy('index');
}

export function getMessage(id: string) {
    return db.messages.get(id);
}

export function messageByStream(streamId: string) {
    return db.messages.where('stream_id').equals(streamId).first();
}

export async function softDeleteMessage(id: string): Promise<void> {
    await db.transaction('rw', db.messages, async () => {
        const m = await db.messages.get(id);
        if (!m) return;
        await db.messages.put({ ...m, deleted: true, updated_at: nowSec() });
    });
}

export async function hardDeleteMessage(id: string): Promise<void> {
    await db.messages.delete(id);
}

// Append a message to a thread and update thread timestamps atomically
export async function appendMessage(input: MessageCreate): Promise<Message> {
    return db.transaction('rw', db.messages, db.threads, async () => {
        const value = parseOrThrow(MessageCreateSchema, input);
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
        await db.messages.put(value);
        const t = await db.threads.get(value.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        return value;
    });
}

// Move a message to another thread, computing next index in destination
export async function moveMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
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
    });
}

// Copy a message into another thread (new id) and update dest thread timestamps
export async function copyMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
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
    });
}

// Insert a message right after a given message id, adjusting index using sparse spacing
export async function insertMessageAfter(
    afterMessageId: string,
    input: Omit<MessageCreate, 'index'>
): Promise<Message> {
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
        const value = parseOrThrow(MessageCreateSchema, {
            ...input,
            index: newIndex,
            thread_id: after.thread_id,
        });
        await db.messages.put(value);
        const t = await db.threads.get(after.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        return value;
    });
}

// Compact / normalize indexes for a thread to 1000, 2000, 3000...
export async function normalizeThreadIndexes(
    threadId: string,
    start = 1000,
    step = 1000
): Promise<void> {
    await db.transaction('rw', db.messages, async () => {
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
    });
}
