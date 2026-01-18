import Dexie from 'dexie';
import { getDb } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { newId, nowSec, parseOrThrow, nextClock } from './util';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';
import type { MessageEntity } from '../core/hooks/hook-types';
import { serializeFileHashes } from './files-util';

// Convert Message schema type to MessageEntity for hooks
function toMessageEntity(msg: Message): MessageEntity {
    // Validate role is one of the expected types
    const role = msg.role;
    // Cast data to proper type, defaulting to empty object if null/undefined
    const safeData =
        msg.data != null
            ? (msg.data as Record<string, unknown>)
            : ({} as Record<string, unknown>);
    return {
        id: msg.id,
        thread_id: msg.thread_id,
        role: role as 'user' | 'assistant' | 'system',
        data: safeData,
        index: msg.index,
        created_at: msg.created_at,
        updated_at: msg.updated_at,
    };
}

/**
 * Type guard to check if an object has file_hashes property
 */
function hasFileHashesArray(obj: unknown): obj is { file_hashes: string[] } {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'file_hashes' in obj &&
        Array.isArray((obj as { file_hashes: unknown }).file_hashes)
    );
}

export async function createMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    const filtered: unknown = await hooks.applyFilters(
        'db.messages.create:filter:input',
        input
    );
    // Support passing file_hashes as string[] for convenience
    if (hasFileHashesArray(filtered)) {
        (filtered as { file_hashes: string | string[] }).file_hashes =
            serializeFileHashes(filtered.file_hashes);
    }
    // Apply defaults (id/clock/timestamps) then validate fully
    const prepared = parseOrThrow(MessageCreateSchema, filtered);
    const value = parseOrThrow(MessageSchema, {
        ...prepared,
        clock: nextClock(prepared.clock),
    });
    await hooks.doAction('db.messages.create:action:before', {
        entity: toMessageEntity(value),
        tableName: 'messages',
    });
    await dbTry(
        () => getDb().messages.put(value),
        { op: 'write', entity: 'messages', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.messages.create:action:after', {
        entity: toMessageEntity(value),
        tableName: 'messages',
    });
    return value;
}

export async function upsertMessage(value: Message): Promise<void> {
    const hooks = useHooks();
    const filtered: unknown = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        value
    );
    const validated = parseOrThrow(MessageSchema, filtered);
    const existing = await dbTry(() => getDb().messages.get(validated.id), {
        op: 'read',
        entity: 'messages',
        action: 'get',
    });
    const next = {
        ...validated,
        clock: nextClock(existing?.clock ?? validated.clock),
    };
    await hooks.doAction('db.messages.upsert:action:before', {
        entity: toMessageEntity(next),
        tableName: 'messages',
    });
    await dbTry(
        () => getDb().messages.put(next),
        { op: 'write', entity: 'messages', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.messages.upsert:action:after', {
        entity: toMessageEntity(next),
        tableName: 'messages',
    });
}

export function messagesByThread(threadId: string) {
    const hooks = useHooks();
    return dbTry(
        () => getDb().messages.where('thread_id').equals(threadId).sortBy('index'),
        { op: 'read', entity: 'messages', action: 'byThread' }
    ).then((res) =>
        hooks.applyFilters('db.messages.byThread:filter:output', res)
    );
}

export function getMessage(id: string) {
    const hooks = useHooks();
    return dbTry(() => getDb().messages.get(id), {
        op: 'read',
        entity: 'messages',
        action: 'get',
    }).then((res) =>
        res
            ? hooks.applyFilters('db.messages.get:filter:output', res)
            : undefined
    );
}

export function messageByStream(streamId: string) {
    const hooks = useHooks();
    return dbTry(
        () => getDb().messages.where('stream_id').equals(streamId).first(),
        { op: 'read', entity: 'messages', action: 'byStream' }
    ).then((res) =>
        hooks.applyFilters('db.messages.byStream:filter:output', res)
    );
}

export async function softDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().messages, async () => {
        const m = await dbTry(() => getDb().messages.get(id), {
            op: 'read',
            entity: 'messages',
            action: 'get',
        });
        if (!m) return;
        await hooks.doAction('db.messages.delete:action:soft:before', {
            entity: toMessageEntity(m),
            id: m.id,
            tableName: 'messages',
        });
        await dbTry(
            () =>
                getDb().messages.put({
                    ...m,
                    deleted: true,
                    updated_at: nowSec(),
                    clock: nextClock(m.clock),
                }),
            { op: 'write', entity: 'messages', action: 'softDelete' }
        );
        await hooks.doAction('db.messages.delete:action:soft:after', {
            entity: toMessageEntity(m),
            id: m.id,
            tableName: 'messages',
        });
    });
}

export async function hardDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => getDb().messages.get(id), {
        op: 'read',
        entity: 'messages',
        action: 'get',
    });
    await hooks.doAction('db.messages.delete:action:hard:before', {
        entity: toMessageEntity(existing!),
        id,
        tableName: 'messages',
    });
    await dbTry(() => getDb().messages.delete(id), {
        op: 'write',
        entity: 'messages',
        action: 'hardDelete',
    });
    await hooks.doAction('db.messages.delete:action:hard:after', {
        entity: toMessageEntity(existing!),
        id,
        tableName: 'messages',
    });
}

// Append a message to a thread and update thread timestamps atomically
export async function appendMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    return getDb().transaction('rw', getDb().messages, getDb().threads, async () => {
        // Handle file_hashes array serialization
        const processedInput = { ...input };
        if (hasFileHashesArray(processedInput)) {
            (processedInput as { file_hashes: string | string[] }).file_hashes =
                serializeFileHashes(processedInput.file_hashes);
        }
        const value = parseOrThrow(MessageCreateSchema, processedInput);
        await hooks.doAction('db.messages.append:action:before', value);
        // If index not set, compute next sparse index in thread
        if (value.index === undefined) {
            const last = await getDb().messages
                .where('[thread_id+index]')
                .between(
                    [value.thread_id, Dexie.minKey],
                    [value.thread_id, Dexie.maxKey]
                )
                .last();
            value.index = last ? last.index + 1000 : 1000;
        }
        const finalized = parseOrThrow(MessageSchema, {
            ...value,
            clock: nextClock(value.clock),
        });
        await getDb().messages.put(finalized);
        const t = await getDb().threads.get(value.thread_id);
        if (t) {
            const now = nowSec();
            await getDb().threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
                clock: nextClock(t.clock),
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
    await getDb().transaction('rw', getDb().messages, getDb().threads, async () => {
        const m = await getDb().messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.move:action:before', {
            message: m,
            toThreadId,
        });
        const last = await getDb().messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await getDb().messages.put({
            ...m,
            thread_id: toThreadId,
            index: nextIdx,
            updated_at: nowSec(),
            clock: nextClock(m.clock),
        });

        const now = nowSec();
        const t = await getDb().threads.get(toThreadId);
        if (t)
            await getDb().threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
                clock: nextClock(t.clock),
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
    await getDb().transaction('rw', getDb().messages, getDb().threads, async () => {
        const m = await getDb().messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.copy:action:before', {
            message: m,
            toThreadId,
        });
        const last = await getDb().messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await getDb().messages.put({
            ...m,
            id: newId(),
            thread_id: toThreadId,
            index: nextIdx,
            created_at: nowSec(),
            updated_at: nowSec(),
            clock: nextClock(),
        });

        const now = nowSec();
        const t = await getDb().threads.get(toThreadId);
        if (t)
            await getDb().threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
                clock: nextClock(t.clock),
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
    return getDb().transaction('rw', getDb().messages, getDb().threads, async () => {
        const after = await getDb().messages.get(afterMessageId);
        if (!after) throw new Error('after message not found');
        const next = await getDb().messages
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
        // Handle file_hashes array serialization
        const processedInput = { ...input };
        if (hasFileHashesArray(processedInput)) {
            (processedInput as { file_hashes: string | string[] }).file_hashes =
                serializeFileHashes(processedInput.file_hashes);
        }
        const value = parseOrThrow(MessageCreateSchema, {
            ...processedInput,
            index: newIndex,
            thread_id: after.thread_id,
        });
        await hooks.doAction('db.messages.insertAfter:action:before', {
            after,
            value,
        });
        const finalized = parseOrThrow(MessageSchema, {
            ...value,
            clock: nextClock(value.clock),
        });
        await getDb().messages.put(finalized);
        const t = await getDb().threads.get(after.thread_id);
        if (t) {
            const now = nowSec();
            await getDb().threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
                clock: nextClock(t.clock),
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
    await getDb().transaction('rw', getDb().messages, async () => {
        await hooks.doAction('db.messages.normalize:action:before', {
            threadId,
            start,
            step,
        });
        const msgs = await getDb().messages
            .where('[thread_id+index]')
            .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
            .toArray();
        msgs.sort((a, b) => a.index - b.index);
        let idx = start;
        for (const m of msgs) {
            if (m.index !== idx) {
                await getDb().messages.put({
                    ...m,
                    index: idx,
                    updated_at: nowSec(),
                    clock: nextClock(m.clock),
                });
            }
            idx += step;
        }
        await hooks.doAction('db.messages.normalize:action:after', {
            threadId,
        });
    });
}
