/**
 * @module app/db/messages
 *
 * Purpose:
 * Message persistence helpers with hook integration and thread updates.
 *
 * Responsibilities:
 * - Validate and store message records
 * - Maintain message ordering via index and order_key
 * - Provide transactional operations that update threads
 *
 * Non-responsibilities:
 * - Rendering message content
 * - Server-side synchronization
 */
import Dexie from 'dexie';
import { getDb } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { newId, nowSec, parseOrThrow, nextClock } from './util';
import { generateHLC } from '../core/sync/hlc';
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

type MessageWriteTxOptions = {
    includeThreads?: boolean;
    includeTombstones?: boolean;
};

function getMessageWriteTxTableNames(
    db: ReturnType<typeof getDb>,
    options: MessageWriteTxOptions = {}
): string[] {
    const tableNames = Array.isArray((db as { tables?: Array<{ name: string }> }).tables)
        ? (db as { tables: Array<{ name: string }> }).tables.map((table) => table.name)
        : [];
    const existing = new Set(tableNames);
    const names = ['messages'];

    if (options.includeThreads) {
        names.push('threads');
    }

    if (existing.has('pending_ops')) {
        names.push('pending_ops');
    }

    if (options.includeTombstones && existing.has('tombstones')) {
        names.push('tombstones');
    }

    return names;
}

/**
 * Purpose:
 * Create a message record in the local database.
 *
 * Behavior:
 * Applies filters, normalizes file hashes, validates schemas, and writes to Dexie.
 *
 * Constraints:
 * - Throws on validation errors.
 *
 * Non-Goals:
 * - Does not update thread metadata.
 */
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
        hlc: prepared.hlc ?? generateHLC(),
    });
    await hooks.doAction('db.messages.create:action:before', {
        entity: toMessageEntity(value),
        tableName: 'messages',
    });
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db), async () => {
        await dbTry(
            () => db.messages.put(value),
            { op: 'write', entity: 'messages', action: 'create' },
            { rethrow: true }
        );
    });
    await hooks.doAction('db.messages.create:action:after', {
        entity: toMessageEntity(value),
        tableName: 'messages',
    });
    return value;
}

/**
 * Purpose:
 * Upsert a message record with updated clocks.
 *
 * Behavior:
 * Validates the message, increments clock values, and persists to Dexie.
 *
 * Constraints:
 * - Requires a fully shaped `Message` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
export async function upsertMessage(value: Message): Promise<void> {
    const hooks = useHooks();
    const filtered: unknown = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        value
    );
    const validated = parseOrThrow(MessageSchema, filtered);
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db), async () => {
        const existing = await dbTry(() => db.messages.get(validated.id), {
            op: 'read',
            entity: 'messages',
            action: 'get',
        });
        const next = {
            ...validated,
            clock: nextClock(existing?.clock ?? validated.clock),
            hlc: validated.hlc ?? generateHLC(),
        };
        await hooks.doAction('db.messages.upsert:action:before', {
            entity: toMessageEntity(next),
            tableName: 'messages',
        });
        await dbTry(
            () => db.messages.put(next),
            { op: 'write', entity: 'messages', action: 'upsert' },
            { rethrow: true }
        );
        await hooks.doAction('db.messages.upsert:action:after', {
            entity: toMessageEntity(next),
            tableName: 'messages',
        });
    });
}

/**
 * Purpose:
 * Fetch ordered messages for a thread.
 *
 * Behavior:
 * Queries by thread id and sorts by index, then applies output filters.
 *
 * Constraints:
 * - Uses the active workspace DB.
 *
 * Non-Goals:
 * - Does not paginate results.
 */
export function messagesByThread(threadId: string) {
    const hooks = useHooks();
    return dbTry(
        () => getDb().messages.where('thread_id').equals(threadId).sortBy('index'),
        { op: 'read', entity: 'messages', action: 'byThread' }
    ).then((res) =>
        hooks.applyFilters('db.messages.byThread:filter:output', res)
    );
}

/**
 * Purpose:
 * Fetch a message by id with hook filtering.
 *
 * Behavior:
 * Reads the row and applies output filters.
 *
 * Constraints:
 * - Returns undefined when missing or filtered out.
 *
 * Non-Goals:
 * - Does not fetch related thread data.
 */
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

/**
 * Purpose:
 * Fetch the first message matching a stream id.
 *
 * Behavior:
 * Queries by `stream_id` and applies output filters.
 *
 * Constraints:
 * - Returns undefined if no matching message exists.
 *
 * Non-Goals:
 * - Does not return all stream matches.
 */
export function messageByStream(streamId: string) {
    const hooks = useHooks();
    return dbTry(
        () => getDb().messages.where('stream_id').equals(streamId).first(),
        { op: 'read', entity: 'messages', action: 'byStream' }
    ).then((res) =>
        hooks.applyFilters('db.messages.byStream:filter:output', res)
    );
}

/**
 * Purpose:
 * Soft delete a message row.
 *
 * Behavior:
 * Marks the message as deleted and updates timestamps and clocks.
 *
 * Constraints:
 * - No-op if the message does not exist.
 *
 * Non-Goals:
 * - Does not remove attachments or files.
 */
export async function softDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db), async () => {
        const m = await dbTry(() => db.messages.get(id), {
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
                db.messages.put({
                    ...m,
                    deleted: true,
                    updated_at: nowSec(),
                    clock: nextClock(m.clock),
                    hlc: generateHLC(),
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

/**
 * Purpose:
 * Hard delete a message row by id.
 *
 * Behavior:
 * Deletes the row and emits delete hooks.
 *
 * Constraints:
 * - No-op if the message does not exist.
 *
 * Non-Goals:
 * - Does not update thread metadata.
 */
export async function hardDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db, { includeTombstones: true }), async () => {
        const existing = await dbTry(() => db.messages.get(id), {
            op: 'read',
            entity: 'messages',
            action: 'get',
        });
        if (!existing) return;

        await hooks.doAction('db.messages.delete:action:hard:before', {
            entity: toMessageEntity(existing),
            id,
            tableName: 'messages',
        });
        await dbTry(() => db.messages.delete(id), {
            op: 'write',
            entity: 'messages',
            action: 'hardDelete',
        });
        await hooks.doAction('db.messages.delete:action:hard:after', {
            entity: toMessageEntity(existing),
            id,
            tableName: 'messages',
        });
    });
}

/**
 * Purpose:
 * Append a message to a thread and update thread timestamps.
 *
 * Behavior:
 * Computes the next index when missing, writes the message, and updates the
 * thread metadata inside a transaction.
 *
 * Constraints:
 * - Uses sparse index spacing for insertions.
 *
 * Non-Goals:
 * - Does not normalize indexes unless necessary.
 */
export async function appendMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    const db = getDb();
    return db.transaction('rw', getMessageWriteTxTableNames(db, { includeThreads: true }), async () => {
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
            const last = await db.messages
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
        await db.messages.put(finalized);
        const t = await db.threads.get(value.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
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

/**
 * Purpose:
 * Move a message to another thread.
 *
 * Behavior:
 * Updates thread id and index, then updates destination thread timestamps.
 *
 * Constraints:
 * - No-op if the message does not exist.
 *
 * Non-Goals:
 * - Does not update source thread metadata.
 */
export async function moveMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db, { includeThreads: true }), async () => {
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
            clock: nextClock(m.clock),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
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

/**
 * Purpose:
 * Copy a message into another thread with a new id.
 *
 * Behavior:
 * Clones the message, assigns a new index, and updates destination thread
 * metadata inside a transaction.
 *
 * Constraints:
 * - No-op if the source message does not exist.
 *
 * Non-Goals:
 * - Does not copy related entities beyond the message row.
 */
export async function copyMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db, { includeThreads: true }), async () => {
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
            clock: nextClock(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
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

/**
 * Purpose:
 * Insert a message immediately after another message.
 *
 * Behavior:
 * Computes a sparse index between neighbors, normalizes when needed, then
 * inserts the message and updates thread timestamps.
 *
 * Constraints:
 * - Throws if the anchor message is missing.
 *
 * Non-Goals:
 * - Does not support arbitrary reordering beyond single insertions.
 */
export async function insertMessageAfter(
    afterMessageId: string,
    input: Omit<MessageCreate, 'index'>
): Promise<Message> {
    const hooks = useHooks();
    const db = getDb();
    return db.transaction('rw', getMessageWriteTxTableNames(db, { includeThreads: true }), async () => {
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
        await db.messages.put(finalized);
        const t = await db.threads.get(after.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
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

/**
 * Purpose:
 * Normalize message indexes within a thread.
 *
 * Behavior:
 * Rewrites indexes to a uniform step to restore sparse gaps.
 *
 * Constraints:
 * - Runs inside a transaction on the messages table.
 *
 * Non-Goals:
 * - Does not update thread metadata.
 */
export async function normalizeThreadIndexes(
    threadId: string,
    start = 1000,
    step = 1000
): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getMessageWriteTxTableNames(db), async () => {
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
        const updates: Message[] = [];
        for (const m of msgs) {
            if (m.index !== idx) {
                updates.push({
                    ...m,
                    index: idx,
                    updated_at: nowSec(),
                    clock: nextClock(m.clock),
                });
            }
            idx += step;
        }
        if (updates.length > 0) {
            await db.messages.bulkPut(updates);
        }
        await hooks.doAction('db.messages.normalize:action:after', {
            threadId,
        });
    });
}
