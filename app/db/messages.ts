import { db } from './client';
import { newId, nowSec, parseOrThrow } from './util';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';

export async function createMessage(input: MessageCreate): Promise<Message> {
    const value = parseOrThrow<Message>(MessageCreateSchema, input);
    await db.messages.put(value);
    return value;
}

export async function upsertMessage(value: Message): Promise<void> {
    parseOrThrow<Message>(MessageSchema, value);
    await db.messages.put(value);
}

export function messagesByThread(threadId: string) {
    return db.messages.where('thread_id').equals(threadId).sortBy('index');
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
        const value = parseOrThrow<Message>(MessageCreateSchema, input);
        // If index not set, compute next index in thread
        let idx = value.index;
        if (idx === undefined || idx === null) {
            const last = await db.messages
                .where('thread_id')
                .equals(value.thread_id)
                .reverse()
                .sortBy('index');
            idx = (last[0]?.index ?? -1) + 1;
            value.index = idx;
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
            .where('thread_id')
            .equals(toThreadId)
            .reverse()
            .sortBy('index');
        const nextIdx = (last[0]?.index ?? -1) + 1;
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
            .where('thread_id')
            .equals(toThreadId)
            .reverse()
            .sortBy('index');
        const nextIdx = (last[0]?.index ?? -1) + 1;
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
