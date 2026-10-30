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
import { parseToolResultArtifact, prepareToolResultStorage, readToolResultStorage, type ToolResultArtifactRow } from '~~/shared/chat/tool-result-artifact';
import {
    jsonCardValue,
    assertCardStateLimits,
} from '~~/shared/chat/tool-card-data';
import { getDb, type Or3DB } from './client';
import { dbTry, dbRequired, dbBestEffort } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import {
    newId,
    nowSec,
    parseOrThrow,
    nextClock,
    getWriteTxTableNames,
} from './util';
import { generateHLC } from '../core/sync/hlc';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';
import type { MessageEntity } from '../core/hooks/hook-types';
import { serializeFileHashes } from './files-util';

export function compareMessageOrder(
    a: Pick<Message, 'order_key' | 'id'> & { index?: number },
    b: Pick<Message, 'order_key' | 'id'> & { index?: number }
): number {
    const indexOrder = (a.index ?? 0) - (b.index ?? 0);
    if (indexOrder !== 0) return indexOrder;
    const keyOrder = (a.order_key ?? '').localeCompare(b.order_key ?? '');
    return keyOrder !== 0 ? keyOrder : a.id.localeCompare(b.id);
}

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
    return createMessageInDb(getDb(), input);
}

/**
 * Create a message in an explicitly captured workspace database.
 *
 * Long-running request flows must use this variant so a workspace switch cannot
 * split related records (a thread in one workspace, its first message in
 * another).
 */
export async function createMessageInDb(db: Or3DB, input: MessageCreate): Promise<Message> {
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
    await db.transaction('rw', getWriteTxTableNames(db, 'messages'), async () => {
        await dbRequired(
            () => db.messages.put(value),
            { op: 'write', entity: 'messages', action: 'create' }
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
    return upsertMessageInDb(getDb(), value);
}

/**
 * Upsert a message in an explicitly captured workspace database.
 *
 * Transaction safety:
 * Arbitrary plugin hooks run outside the write transaction. Awaiting timers,
 * network requests, or other non-IndexedDB work between two Dexie operations
 * lets IndexedDB auto-commit the idle transaction, so the later `put` would
 * fail with an inactive transaction. Only the re-read + `put` run inside.
 */
export async function upsertMessageInDb(
    db: Or3DB,
    value: Message
): Promise<void> {
    const hooks = useHooks();
    const filtered: unknown = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        value
    );
    const validated = parseOrThrow(MessageSchema, filtered);
    // Best-effort clock for the pre-commit notification; the authoritative
    // bump is recomputed from a fresh read inside the transaction.
    const previewExisting = await dbBestEffort(
        () => db.messages.get(validated.id),
        { op: 'read', entity: 'messages', action: 'get' }
    );
    const preview = {
        ...validated,
        clock: nextClock(previewExisting?.clock ?? validated.clock),
        hlc: validated.hlc ?? generateHLC(),
    };
    await hooks.doAction('db.messages.upsert:action:before', {
        entity: toMessageEntity(preview),
        tableName: 'messages',
    });
    const next = await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages'),
        async () => {
            const existing = await dbRequired(
                () => db.messages.get(validated.id),
                { op: 'read', entity: 'messages', action: 'get' }
            );
            const fresh = {
                ...validated,
                clock: nextClock(existing?.clock ?? validated.clock),
                hlc: validated.hlc ?? generateHLC(),
            };
            await dbRequired(
                () => db.messages.put(fresh),
                { op: 'write', entity: 'messages', action: 'upsert' }
            );
            return fresh;
        }
    );
    await hooks.doAction('db.messages.upsert:action:after', {
        entity: toMessageEntity(next),
        tableName: 'messages',
    });
}

function dataRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}

function jsonEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

/**
 * Purpose:
 * Atomically merge a partial patch against the current row inside a single
 * write transaction.
 *
 * Behavior:
 * Reads the latest row, deep-merges `data`, applies top-level fields, bumps
 * clocks, and writes — all inside one Dexie transaction so concurrent writers
 * cannot interleave between the read and the write. Callers must pass only
 * the delta they own; untouched keys are preserved from the latest row.
 *
 * Constraints:
 * - No-op when the row does not exist and no fallback is supplied.
 * - An optional synchronous `ifCurrent` guard checks the stored row inside
 *   the write transaction; false skips the write, including fallback creation.
 * - `commitGuard` adds authorization tables and runs transaction-safe checks
 *   after hooks and before the fresh-row write. It must not await external work.
 *
 * Non-Goals:
 * - Does not replace `upsertMessageInDb` for full-row replaces.
 */
export async function patchMessageInDb(
    db: Or3DB,
    id: string,
    patch: Partial<Message> & {
        data?: Record<string, unknown> | null;
    },
    fallback?: Message | null,
    ifCurrent?: (message: Message | undefined) => boolean,
    entryPatch?: { field: string; key: string; value: unknown | null },
    commitGuard?: { tables: string[]; assertCurrent: () => void | Promise<void> },
): Promise<Message | undefined> {
    const hooks = useHooks();
    // Preparation hooks run outside the write transaction (see upsertMessageInDb:
    // awaiting arbitrary plugin code between Dexie operations can idle-commit it).
    const baseOutside =
        (await dbTry(() => db.messages.get(id), {
            op: 'read',
            entity: 'messages',
            action: 'get',
        })) ?? fallback;
    if (!baseOutside) {
        if (entryPatch) throw new Error('not-found');
        return;
    }

    const baseOutsideData = dataRecord(baseOutside.data);
    const patchData = { ...dataRecord(patch.data) };
    if (entryPatch) {
        const entries = { ...dataRecord(baseOutsideData[entryPatch.field]) };
        if (entryPatch.value === null) delete entries[entryPatch.key];
        else entries[entryPatch.key] = entryPatch.value;
        patchData[entryPatch.field] = entries;
    }
    const { data: _droppedData, ...topPatch } = patch as Record<
        string,
        unknown
    >;
    const candidateOutside = {
        ...baseOutside,
        ...topPatch,
        id: baseOutside.id,
        data: {
            ...baseOutsideData,
            ...patchData,
            ...('error' in patch
                ? { error: (patch as { error?: unknown }).error }
                : {}),
        },
        updated_at:
            typeof (patch as { updated_at?: unknown }).updated_at === 'number'
                ? (patch as { updated_at: number }).updated_at
                : nowSec(),
    };
    const filteredOutside: unknown = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        candidateOutside
    );
    const validatedOutside = parseOrThrow(MessageSchema, filteredOutside);
    await hooks.doAction('db.messages.upsert:action:before', {
        entity: toMessageEntity(validatedOutside),
        tableName: 'messages',
    });

    // Diff the filtered preparation result against the outside read so the
    // inner transaction can re-apply only owned/filter-touched keys onto the
    // fresh row. Untouched keys stay excluded and survive concurrent writes.
    const validatedOutsideData = dataRecord(validatedOutside.data);
    const dataDelta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validatedOutsideData)) {
        if (!jsonEqual(baseOutsideData[key], value)) dataDelta[key] = value;
    }
    // Deletions are not representable via JSON diff of missing keys; carry an
    // explicit null-clear for owned data keys the caller set to null.
    for (const [key, value] of Object.entries(patchData)) {
        if (value === null) dataDelta[key] = null;
    }
    const entryDelta = new Map<string, unknown>();
    if (entryPatch) {
        const before = dataRecord(baseOutsideData[entryPatch.field]);
        const after = dataRecord(validatedOutsideData[entryPatch.field]);
        for (const key of new Set([
            ...Object.keys(before),
            ...Object.keys(after),
            entryPatch.key,
        ])) {
            if (key === entryPatch.key || !jsonEqual(before[key], after[key]))
                entryDelta.set(
                    key,
                    Object.hasOwn(after, key) ? after[key] : undefined,
                );
        }
        delete dataDelta[entryPatch.field];
    }
    const topDelta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
        validatedOutside as Record<string, unknown>
    )) {
        if (key === 'id' || key === 'data' || key === 'clock' || key === 'hlc') {
            continue;
        }
        if (
            !jsonEqual(
                (baseOutside as Record<string, unknown>)[key],
                value
            )
        ) {
            topDelta[key] = value;
        }
    }

    const next = await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages', { include: commitGuard?.tables }),
        async () => {
            await commitGuard?.assertCurrent();
            const stored = await dbRequired(() => db.messages.get(id), {
                op: 'read',
                entity: 'messages',
                action: 'get',
            });
            if (ifCurrent && !ifCurrent(stored)) {
                if (entryPatch) throw new Error('stale-context');
                return undefined;
            }
            if (entryPatch && (!stored || stored.deleted))
                throw new Error('not-found');
            const base = stored ?? fallback;
            if (!base) return undefined;
            const baseData = dataRecord(base.data);
            const mergedData = { ...baseData, ...dataDelta };
            if (entryPatch) {
                const entries = { ...dataRecord(baseData[entryPatch.field]) };
                for (const [key, value] of entryDelta) {
                    if (value === undefined) delete entries[key];
                    else entries[key] = jsonCardValue(value);
                }
                if (entryPatch.field === 'tool_cards')
                    assertCardStateLimits(entries);
                mergedData[entryPatch.field] = entries;
            }
            const candidate = {
                ...base,
                ...topDelta,
                id: base.id,
                data: mergedData,
                updated_at:
                    typeof topDelta.updated_at === 'number'
                        ? (topDelta.updated_at as number)
                        : nowSec(),
            };
            const validated = parseOrThrow(MessageSchema, candidate);
            const fresh = {
                ...validated,
                clock: nextClock(base.clock),
                hlc: entryPatch
                    ? generateHLC()
                    : (validated as { hlc?: string }).hlc ??
                    (base as { hlc?: string }).hlc ??
                    generateHLC(),
            };
            await dbRequired(
                () => db.messages.put(fresh),
                { op: 'write', entity: 'messages', action: 'upsert' }
            );
            return fresh;
        },
    );
    if (!next) return;
    await hooks.doAction('db.messages.upsert:action:after', {
        entity: toMessageEntity(next),
        tableName: 'messages',
    });
    return next;
}

/**
 * Purpose:
 * Fetch ordered messages for a thread.
 *
 * Behavior:
 * Queries by thread id and sorts by index, then applies output filters.
 *
 * Constraints:
 * - Uses the active workspace DB unless an explicit DB is supplied.
 *
 * Non-Goals:
 * - Does not paginate results.
 */
export function messagesByThread(threadId: string, db?: Or3DB) {
    const hooks = useHooks();
    return dbTry(
        () =>
            (db ?? getDb())
                .messages.where('[thread_id+index]')
                .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
                .toArray(),
        { op: 'read', entity: 'messages', action: 'byThread' }
    ).then(async (res) => {
        const filtered = await hooks.applyFilters(
            'db.messages.byThread:filter:output',
            res
        );
        if (Array.isArray(filtered)) filtered.sort(compareMessageOrder);
        return filtered;
    });
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
    const hooks = useHooks(); const db = getDb();
    const source = await db.messages.get(id);
    if (!source || source.deleted) return;
    await hooks.doAction('db.messages.delete:action:soft:before', { entity: toMessageEntity(source), id, tableName: 'messages' });
    const deleted = await db.transaction('rw', getWriteTxTableNames(db, 'messages', { includeTombstones: true }), async () => {
        const current = await db.messages.get(id);
        if (!current || current.deleted) return;
        await db.messages.put({ ...current, deleted: true, updated_at: nowSec(), clock: nextClock(current.clock), hlc: generateHLC() });
        return current;
    });
    if (deleted) await hooks.doAction('db.messages.delete:action:soft:after', { entity: toMessageEntity(deleted), id, tableName: 'messages' });
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
    const hooks = useHooks(); const db = getDb();
    const source = await db.messages.get(id);
    if (!source) return;
    await hooks.doAction('db.messages.delete:action:hard:before', { entity: toMessageEntity(source), id, tableName: 'messages' });
    const deleted = await db.transaction('rw', getWriteTxTableNames(db, 'messages', { includeTombstones: true }), async () => {
        const current = await db.messages.get(id);
        if (!current) return;
        await db.messages.delete(id);
        return current;
    });
    if (deleted) await hooks.doAction('db.messages.delete:action:hard:after', { entity: toMessageEntity(deleted), id, tableName: 'messages' });
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
    return appendMessageToDb(getDb(), input);
}

/**
 * Append a message in an explicitly captured workspace database.
 */
export type MessageRevision = Pick<Message, 'id' | 'clock' | 'hlc'>;

export async function appendMessageToDb(
    db: Or3DB,
    input: MessageCreate,
    options: { replace?: readonly MessageRevision[] } = {},
): Promise<Message> {
    const prepared = await prepareMessageAppend(input);
    const hooks = useHooks();
    const replacements: { expected: MessageRevision; row: Message }[] = [];
    for (const expected of options.replace ?? []) {
        const old = await db.messages.get(expected.id);
        if (!old || old.deleted || old.thread_id !== prepared.value.thread_id
            || old.clock !== expected.clock || old.hlc !== expected.hlc)
            throw new Error('Retry target changed; reload the conversation.');
        const data = { ...dataRecord(old.data), superseded_by: prepared.value.id, generation_state: 'superseded' };
        const filtered = await hooks.applyFilters('db.messages.upsert:filter:input', { ...old, data });
        const row = parseOrThrow(MessageSchema, { ...filtered, id: old.id, thread_id: old.thread_id,
            data: { ...dataRecord(filtered.data), superseded_by: prepared.value.id, generation_state: 'superseded' },
            updated_at: nowSec(), clock: nextClock(old.clock), hlc: generateHLC() });
        await hooks.doAction('db.messages.upsert:action:before', { entity: toMessageEntity(row), tableName: 'messages' });
        replacements.push({ expected, row });
    }
    const message = await db.transaction(
        'rw', getWriteTxTableNames(db, 'messages', { include: ['threads'] }), async () => {
            // Validate the complete selected revision before any writes. All old
            // rows and the admitted replacement share one outbox transaction.
            for (const { expected } of replacements) {
                const current = await db.messages.get(expected.id);
                if (!current || current.deleted || current.thread_id !== prepared.value.thread_id
                    || current.clock !== expected.clock || current.hlc !== expected.hlc)
                    throw new Error('Retry target changed; reload the conversation.');
            }
            for (const { row } of replacements) await db.messages.put(row);
            return appendMessageRows(db, prepared.value);
        },
    );
    await prepared.afterCommit(message);
    for (const { row } of replacements) {
        try { await hooks.doAction('db.messages.upsert:action:after', { entity: toMessageEntity(row), tableName: 'messages' }); }
        catch (error) { console.warn('[messages] Retry committed; notification failed', error); }
    }
    return message;
}

/** Prepare hooks outside the caller's write transaction. */
export async function prepareMessageAppend(input: MessageCreate) {
    const hooks = useHooks();
    const processedInput = structuredClone(input);
    if (hasFileHashesArray(processedInput)) {
        (processedInput as { file_hashes: string | string[] }).file_hashes = serializeFileHashes(processedInput.file_hashes);
    }
    const value = parseOrThrow(MessageCreateSchema, processedInput);
    await hooks.doAction('db.messages.append:action:before', value);
    return {
        value: parseOrThrow(MessageCreateSchema, value),
        async afterCommit(message: Message) {
            try { await hooks.doAction('db.messages.append:action:after', message); }
            catch (error) { console.warn('[messages] Append committed; notification failed', error); }
        },
    };
}

/** Hook-free append for guarded callers sharing their atomic write. */
export async function appendMessageRows(db: Or3DB, input: MessageCreate): Promise<Message> {
    // Dexie's declaration omits the absent outside-transaction case.
    const transaction = Dexie.currentTransaction as typeof Dexie.currentTransaction | undefined;
    if (!transaction || transaction.db !== db || transaction.mode !== 'readwrite')
        throw new Error('Message append requires its captured write transaction.');
    const value = parseOrThrow(MessageCreateSchema, input);
    const t = await db.threads.get(value.thread_id);
    if (!t || t.deleted) throw new Error('Cannot append to a missing or deleted thread.');
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
    const now = nowSec();
    await db.threads.put({
        ...t,
        last_message_at: now,
        updated_at: now,
        clock: nextClock(t.clock),
    });
    return finalized;
}

/** Prepare dependent bytes outside the transaction, then fence the source revision. */
async function prepareTransferredToolResults(db: Or3DB, source: Message, threadId: string) {
    const rows: ToolResultArtifactRow[] = [];
    if (source.thread_id === threadId) return { data: source.data, rows, changed: false };
    const data = { ...dataRecord(source.data) };
    const parentAssistantId = typeof data.parent_assistant_id === 'string' ? data.parent_assistant_id : source.id;
    const replacements = new Map<string, string>();
    const rehome = async (value: unknown, callId: string): Promise<unknown> => {
        if (typeof value !== 'string' || !parseToolResultArtifact(value)) return value;
        const existing = replacements.get(value);
        if (existing !== undefined) return existing;
        const output = await readToolResultStorage(value, id => db.kv.get(id));
        const storage = await prepareToolResultStorage(output, { threadId, parentAssistantId, callId });
        rows.push(...storage.rows);
        replacements.set(value, storage.result);
        return storage.result;
    };
    if (source.role === 'tool') data.content = await rehome(data.content,
        typeof data.tool_call_id === 'string' ? data.tool_call_id : source.id);
    if (Array.isArray(data.tool_calls)) {
        data.tool_calls = await Promise.all(data.tool_calls.map(async value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
            const call = dataRecord(value);
            const id = typeof call.id === 'string' ? call.id : source.id;
            const transcript = dataRecord(call.transcript);
            return { ...call,
                ...('result' in call ? { result: await rehome(call.result, id) } : {}),
                ...('result' in transcript ? { transcript: { ...transcript, result: await rehome(transcript.result, id) } } : {}),
            };
        }));
    }
    const changed = replacements.size > 0;
    return { data: changed ? data : source.data, rows, changed };
}

function assertTransferSource(current: Message, source: Message): void {
    // Even an initially inline result may become an artifact during preparation.
    // Never commit fresh data with dependencies from an older source snapshot.
    if (current.clock !== source.clock || current.hlc !== source.hlc
        || current.thread_id !== source.thread_id || !jsonEqual(current.data, source.data))
        throw new Error('Message changed while preparing transfer; retry.');
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
    const source = await db.messages.get(messageId);
    if (!source || source.deleted) return;
    await hooks.doAction('db.messages.move:action:before', { message: source, toThreadId });
    const preparedSource = await db.messages.get(messageId);
    if (!preparedSource || preparedSource.deleted) return;
    const transfer = await prepareTransferredToolResults(db, preparedSource, toThreadId);
    const changed = await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages', { include: ['threads', 'kv'] }),
        async () => {
        const m = await db.messages.get(messageId);
        if (!m || m.deleted) return;
        assertTransferSource(m, preparedSource);
        const parent = await db.threads.get(toThreadId);
        if (!parent || parent.deleted) throw new Error('Destination thread unavailable.');
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        if (transfer.rows.length) await db.kv.bulkPut(transfer.rows);
        await db.messages.put({
            ...m,
            ...(transfer.changed ? { data: transfer.data } : {}),
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
        return true;
    });
    if (changed) await hooks.doAction('db.messages.move:action:after', { messageId, toThreadId });
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
 * - Does not copy other transcript rows. Referenced tool-result bytes are retained.
 */
export async function copyMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    const source = await db.messages.get(messageId);
    if (!source || source.deleted) return;
    await hooks.doAction('db.messages.copy:action:before', { message: source, toThreadId });
    const preparedSource = await db.messages.get(messageId);
    if (!preparedSource || preparedSource.deleted) return;
    const transfer = await prepareTransferredToolResults(db, preparedSource, toThreadId);
    const changed = await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages', { include: ['threads', 'kv'] }),
        async () => {
        const m = await db.messages.get(messageId);
        if (!m || m.deleted) return;
        assertTransferSource(m, preparedSource);
        const parent = await db.threads.get(toThreadId);
        if (!parent || parent.deleted) throw new Error('Destination thread unavailable.');
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        if (transfer.rows.length) await db.kv.bulkPut(transfer.rows);
        await db.messages.put({
            ...m,
            ...(transfer.changed ? { data: transfer.data } : {}),
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
        return true;
    });
    if (changed) await hooks.doAction('db.messages.copy:action:after', { from: messageId, toThreadId });
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
    const after = await db.messages.get(afterMessageId);
    if (!after || after.deleted) throw new Error('after message not found');
    const rows = (await db.messages.where('thread_id').equals(after.thread_id).toArray()).sort(compareMessageOrder);
    const position = rows.findIndex(row => row.id === afterMessageId);
    const next = rows[position + 1];
    const normalize = !!next && next.index - after.index <= 1;
    const orderIdentity = (values: Message[]) => JSON.stringify(values.map(row => [row.id, row.index, row.order_key, row.deleted]));
    const expectedOrder = orderIdentity(rows);
    const newIndex = normalize ? 1000 + position * 1000 + 500
        : next ? after.index + Math.floor((next.index - after.index) / 2) : after.index + 1000;
    const processedInput = { ...input };
    if (hasFileHashesArray(processedInput)) {
        (processedInput as { file_hashes: string | string[] }).file_hashes = serializeFileHashes(processedInput.file_hashes);
    }
    const value = parseOrThrow(MessageCreateSchema, { ...processedInput, index: newIndex, thread_id: after.thread_id });
    // Plugin actions may await network/timers; no IndexedDB transaction is open.
    if (normalize) await hooks.doAction('db.messages.normalize:action:before', { threadId: after.thread_id, start: 1000, step: 1000 });
    await hooks.doAction('db.messages.insertAfter:action:before', { after, value });
    const finalized = await db.transaction(
        'rw', getWriteTxTableNames(db, 'messages', { include: ['threads'] }), async () => {
            const currentRows = (await db.messages.where('thread_id').equals(after.thread_id).toArray()).sort(compareMessageOrder);
            const parent = await db.threads.get(after.thread_id);
            if (!parent || parent.deleted) throw new Error('Cannot insert into a missing or deleted thread.');
            // A preparation action may itself change ordering. Do not commit a
            // stale insertion plan or normalize a different set of rows.
            if (orderIdentity(currentRows) !== expectedOrder) throw new Error('Message order changed during insertion; retry.');
            if (normalize) await normalizeThreadIndexRows(db, after.thread_id);
            const result = parseOrThrow(MessageSchema, { ...value, thread_id: after.thread_id, index: newIndex, clock: nextClock(value.clock) });
            await db.messages.put(result);
            const now = nowSec();
            await db.threads.put({ ...parent, last_message_at: now, updated_at: now, clock: nextClock(parent.clock) });
            return result;
        },
    );
    if (normalize) await hooks.doAction('db.messages.normalize:action:after', { threadId: after.thread_id });
    await hooks.doAction('db.messages.insertAfter:action:after', finalized);
    return finalized;
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
export async function normalizeThreadIndexes(threadId: string, start = 1000, step = 1000): Promise<void> {
    const hooks = useHooks(); const db = getDb();
    await hooks.doAction('db.messages.normalize:action:before', { threadId, start, step });
    await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => normalizeThreadIndexRows(db, threadId, start, step));
    await hooks.doAction('db.messages.normalize:action:after', { threadId });
}

async function normalizeThreadIndexRows(db: Or3DB, threadId: string, start = 1000, step = 1000): Promise<void> {
    const rows = (await db.messages.where('thread_id').equals(threadId).toArray()).sort(compareMessageOrder);
    const updates = rows.flatMap((row, index) => row.index === start + index * step ? [] : [{ ...row,
        index: start + index * step, updated_at: nowSec(), clock: nextClock(row.clock) }]);
    if (updates.length) await db.messages.bulkPut(updates);
}

/** Merge one nested data entry using the same preparation and atomic write path. */
export async function patchMessageDataEntry(
    db: Or3DB,
    id: string,
    field: string,
    entryKey: string,
    value: unknown | null,
    current?: (message: Message | undefined) => boolean,
): Promise<void> {
    if (
        [field, entryKey].some(
            (key) =>
                !key || ['__proto__', 'constructor', 'prototype'].includes(key),
        )
    )
        throw new Error('invalid-input');
    const snapshot = value === null ? null : jsonCardValue(value);
    if (field === 'tool_cards' && snapshot !== null)
        assertCardStateLimits({ [entryKey]: snapshot });
    await patchMessageInDb(db, id, {}, undefined, current, {
        field,
        key: entryKey,
        value: snapshot,
    });
}
