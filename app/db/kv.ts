/**
 * @module app/db/kv
 *
 * Purpose:
 * Key value storage helpers with hook integration.
 *
 * Responsibilities:
 * - Provide CRUD helpers for the KV table
 * - Ensure the active DB is open before operations
 *
 * Non-responsibilities:
 * - Storing secrets outside the KV table
 * - Schema migrations or indexing
 */
import { getDb, type Or3DB } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock, getWriteTxTableNames } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

async function ensureDbOpen(targetDb: Or3DB): Promise<void> {
    if (!targetDb.isOpen()) {
        await targetDb.open();
    }
}

/**
 * Revocation guard for plugin storage mutations. The broker aborts the
 * operation's AbortSignal when the activation is deactivated/revoked; an
 * optional `isValid` callback covers host-side validity the signal cannot see.
 * Checked before any commit and again inside the transaction immediately
 * before mutation, so a write waiting in a hook or DB queue cannot commit
 * after its authority died.
 */
export interface StorageMutationGuard {
    readonly signal?: AbortSignal;
    readonly isValid?: () => boolean;
}

/**
 * Scoped usage accounting enforced atomically with the mutation itself, so
 * concurrent writers cannot jointly over-admit past the caps. Usage is derived
 * inside the write transaction from the live rows named by `prefix`; it is
 * never stored as a synchronized counter row, because LWW would keep one
 * device's increment while both data rows survive. Deriving from the rows also
 * keeps accounting consistent with whatever remote application materialized.
 * Policy (scope prefix, limits) belongs to the caller, mechanism lives here.
 */
export interface StorageQuota {
    readonly prefix: string;
    readonly maxBytes: number;
    readonly maxKeys: number;
    /** Maximum distinct names retained, including deleted names. */
    readonly maxRetainedKeys?: number;
}

function throwIfRevoked(guard?: StorageMutationGuard): void {
    if (guard?.signal?.aborted) {
        throw Object.assign(new Error('Storage operation was revoked'), {
            rpcCode: 'cancelled',
        });
    }
    if (guard?.isValid && !guard.isValid()) {
        throw Object.assign(new Error('Plugin activation was revoked'), {
            rpcCode: 'cancelled',
        });
    }
}

function throwIfBadClock(ifClock: number | null | undefined): void {
    if (
        ifClock !== undefined &&
        ifClock !== null &&
        (!Number.isSafeInteger(ifClock) || (ifClock as number) < 0)
    ) {
        throw Object.assign(new Error('KV revision must be null or a non-negative safe integer'), {
            rpcCode: 'invalid-input',
        });
    }
}

function staleRevisionError(currentClock: number): Error {
    return Object.assign(new Error('KV revision is stale'), {
        rpcCode: 'conflict',
        currentRevision: currentClock,
        details: { currentRevision: currentClock },
    });
}

/**
 * Read a name's row together with its revision head. The head is the max of
 * the materialized row clock and any sync tombstone clock: snapshot recovery
 * physically removes deleted rows and keeps their history only in
 * `tombstones`, and revision allocation plus CAS must continue past it
 * instead of restarting a new incarnation at revision 1.
 */
async function readKvRevisionState(
    targetDb: Or3DB,
    name: string
): Promise<{ row: Kv | undefined; clock: number }> {
    const row = await dbTry(
        () => targetDb.kv.where('name').equals(name).first(),
        { op: 'read', entity: 'kv', action: 'getByName' },
        { rethrow: true }
    );
    let clock = row?.clock ?? 0;
    const hasTombstones = (Array.isArray(targetDb.tables) ? targetDb.tables : []).some(
        (table) => table.name === 'tombstones'
    );
    if (hasTombstones) {
        const pk = row?.id ?? `kv:${name}`;
        const tombstone = await dbTry(
            () => targetDb.tombstones.get(`kv:${pk}`),
            { op: 'read', entity: 'kv', action: 'getTombstone' },
            { rethrow: true }
        );
        if (tombstone && tombstone.clock > clock) {
            clock = tombstone.clock;
        }
    }
    return { row, clock };
}

const quotaEncoder = new TextEncoder();

function quotaBytes(value: string | null | undefined): number {
    return typeof value === 'string' ? quotaEncoder.encode(value).byteLength : 0;
}

/**
 * Derive the usage a pending write leaves behind, from the live rows in scope.
 * Runs inside the write transaction, so the answer cannot race concurrent
 * writers or remote application.
 */
async function readQuotaUsage(
    targetDb: Or3DB,
    quota: StorageQuota,
    pending: { name: string; value: string | null | undefined }
): Promise<{ bytes: number; keys: number }> {
    const rows =
        (await dbTry(
            () => targetDb.kv.where('name').startsWith(quota.prefix).toArray(),
            { op: 'read', entity: 'kv', action: 'getQuotaUsage' },
            { rethrow: true }
        )) ?? [];
    let bytes = 0;
    let keys = 0;
    if (quota.maxRetainedKeys !== undefined) {
        const retained = new Set(rows.map((row) => row.name));
        if (targetDb.tables?.some((table) => table.name === 'tombstones')) {
            // Snapshots move deletion history out of kv. Count both forms,
            // deduplicating local soft deletes also captured by sync.
            const tombstones = await targetDb.tombstones.where('id')
                .startsWith(`kv:kv:${quota.prefix}`).toArray();
            for (const row of tombstones) retained.add(row.pk.slice(3));
        }
        if (!retained.has(pending.name) && retained.size >= quota.maxRetainedKeys) {
            throw quotaExceededError();
        }
    }
    for (const row of rows) {
        if (row.name === pending.name || row.deleted === true) continue;
        bytes += quotaBytes(row.value);
        keys += 1;
    }
    // The pending write always materializes one live row for its name.
    bytes += quotaBytes(pending.value);
    keys += 1;
    return { bytes, keys };
}

function quotaExceededError(): Error {
    return Object.assign(new Error('Storage quota exceeded'), {
        rpcCode: 'quota-exceeded',
    });
}

/**
 * Purpose:
 * Create a KV record in the local database.
 *
 * Behavior:
 * Applies filters, validates the input, and writes to Dexie.
 *
 * Constraints:
 * - Throws on validation errors.
 *
 * Non-Goals:
 * - Does not perform deduplication by name.
 */
export async function createKv(input: KvCreate): Promise<Kv> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.create:filter:input',
        input
    );
    await hooks.doAction('db.kv.create:action:before', {
        entity: filtered,
        tableName: 'kv',
    });
    const value = parseOrThrow(KvCreateSchema, filtered);
    const next = {
        ...value,
        clock: nextClock(value.clock),
    };
    await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
        await dbTry(
            () => db.kv.put(next),
            { op: 'write', entity: 'kv', action: 'create' },
            { rethrow: true }
        );
    });
    await hooks.doAction('db.kv.create:action:after', {
        entity: next,
        tableName: 'kv',
    });
    return next;
}

/**
 * Purpose:
 * Upsert a KV record using the full schema.
 *
 * Behavior:
 * Validates, updates clock values, and writes to Dexie with hooks.
 *
 * Constraints:
 * - Requires a fully shaped `Kv` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
export async function upsertKv(value: Kv): Promise<void> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.upsert:filter:input',
        value
    );
    await hooks.doAction('db.kv.upsert:action:before', {
        entity: filtered,
        tableName: 'kv',
    });
    await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
        const validated = parseOrThrow(KvSchema, filtered);
        const existing = await dbTry(() => db.kv.get(validated.id), {
            op: 'read',
            entity: 'kv',
            action: 'get',
        });
        const next = {
            ...validated,
            clock: nextClock(existing?.clock ?? validated.clock),
        };
        await dbTry(
            () => db.kv.put(next),
            { op: 'write', entity: 'kv', action: 'upsert' },
            { rethrow: true }
        );
        await hooks.doAction('db.kv.upsert:action:after', {
            entity: next,
            tableName: 'kv',
        });
    });
}

/**
 * Purpose:
 * Hard delete a KV record by id.
 *
 * Behavior:
 * Reads the record, emits delete hooks, and removes it from Dexie.
 *
 * Constraints:
 * - No-op if the record does not exist.
 *
 * Non-Goals:
 * - Does not clear related caches.
 */
export async function hardDeleteKv(id: string): Promise<void> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'kv', { includeTombstones: true }),
        async () => {
        const existing = await dbTry(() => db.kv.get(id), {
            op: 'read',
            entity: 'kv',
            action: 'get',
        });
        if (!existing) return;
        await hooks.doAction('db.kv.delete:action:hard:before', {
            entity: existing,
            id,
            tableName: 'kv',
        });
        await db.kv.delete(id);
        await hooks.doAction('db.kv.delete:action:hard:after', {
            entity: existing,
            id,
            tableName: 'kv',
        });
    });
}

/**
 * Purpose:
 * Fetch a KV record by id with hook filtering.
 *
 * Behavior:
 * Reads the row and applies output filters.
 *
 * Constraints:
 * - Returns undefined when missing or filtered out.
 *
 * Non-Goals:
 * - Does not parse stored values.
 */
export async function getKv(id: string) {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const res = await dbTry(() => db.kv.get(id), {
        op: 'read',
        entity: 'kv',
        action: 'get',
    });
    if (!res) return undefined;
    return hooks.applyFilters('db.kv.get:filter:output', res);
}

/**
 * Purpose:
 * Fetch a KV record by name.
 *
 * Behavior:
 * Queries on the `name` index and applies output filters.
 *
 * Constraints:
 * - Uses the provided DB instance when supplied.
 *
 * Non-Goals:
 * - Does not create the record if missing.
 */
export async function getKvByName(name: string, targetDb: Or3DB = getDb()) {
    await ensureDbOpen(targetDb);
    const hooks = useHooks();
    const res = await dbTry(() => targetDb.kv.where('name').equals(name).first(), {
        op: 'read',
        entity: 'kv',
        action: 'getByName',
    });
    return hooks.applyFilters('db.kv.getByName:filter:output', res);
}

/** Read the value and its CAS revision from one snapshot, including deleted history. */
export async function getKvRecordByName(name: string, targetDb: Or3DB = getDb()) {
    await ensureDbOpen(targetDb);
    const state = await targetDb.transaction(
        'r',
        getWriteTxTableNames(targetDb, 'kv', { includePendingOps: false, includeTombstones: true }),
        () => readKvRevisionState(targetDb, name)
    );
    return {
        row: await useHooks().applyFilters('db.kv.getByName:filter:output', state.row),
        revision: state.clock,
    };
}

// Convenience helpers for auth/session flows
/**
 * Purpose:
 * Set or update a KV record by name.
 *
 * Behavior:
 * Creates the record if missing or updates the existing row with clocks.
 *
 * Constraints:
 * - Uses `kv:${name}` as the id for new records.
 *
 * Non-Goals:
 * - Does not perform transactional writes across tables.
 */
export async function setKvByName(
    name: string,
    value: string | null,
    targetDb: Or3DB = getDb(),
    options: {
        readonly ifClock?: number | null;
        readonly signal?: AbortSignal;
        readonly isValid?: () => boolean;
        readonly quota?: StorageQuota;
    } = {}
): Promise<Kv> {
    throwIfRevoked(options);
    throwIfBadClock(options.ifClock);
    await ensureDbOpen(targetDb);
    throwIfRevoked(options);
    const hooks = useHooks();
    const { row: existing, clock: existingClock } = await readKvRevisionState(
        targetDb,
        name
    );
    throwIfRevoked(options);
    const now = nowSec();
    // A tombstoned row is logically absent, but its clock survives: a
    // delete bumps the revision and the next write continues past it, so a
    // stale pre-delete revision can never match a recreated incarnation. The
    // revision head also spans sync tombstone history left by snapshot
    // recovery, so a recreated key cannot restart at revision 1.
    const liveExisting = existing && !existing.deleted ? existing : undefined;
    if (
        options.ifClock !== undefined &&
        (options.ifClock === null
            ? liveExisting !== undefined
            : options.ifClock !== existingClock)
    ) {
        throw staleRevisionError(existingClock);
    }
    const record: Kv = {
        id: existing?.id ?? `kv:${name}`,
        name,
        value,
        deleted: false,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        clock: nextClock(existingClock),
    };
    const filtered = await hooks.applyFilters(
        'db.kv.upsertByName:filter:input',
        record
    );
    throwIfRevoked(options);
    const kvEntity: Kv =
        'id' in filtered && 'created_at' in filtered
            ? (filtered as Kv)
            : record;
    let committedEntity = kvEntity;
    await targetDb.transaction(
        'rw',
        getWriteTxTableNames(targetDb, 'kv', { includeTombstones: true }),
        async () => {
        // Revocation is re-checked inside the transaction immediately before
        // mutation: a write that waited in a hook or DB queue must not commit
        // after its authority died. A commit that already happened stays
        // committed, so callers get an honest outcome.
        throwIfRevoked(options);
        // Re-read inside the write transaction. The initial read provides a
        // useful fast refusal, but only this check makes ifClock a real CAS
        // boundary when two tabs race on the same key.
        const { row: current, clock: currentClockInTransaction } =
            await readKvRevisionState(targetDb, name);
        throwIfRevoked(options);
        const liveCurrent = current && !current.deleted ? current : undefined;
        if (
            options.ifClock !== undefined &&
            (options.ifClock === null
                ? liveCurrent !== undefined
                : options.ifClock !== currentClockInTransaction)
        ) {
            throw staleRevisionError(currentClockInTransaction);
        }
        const transactionEntity: Kv = {
            ...kvEntity,
            id: current?.id ?? kvEntity.id,
            created_at: current?.created_at ?? kvEntity.created_at,
            deleted: false,
            clock: nextClock(currentClockInTransaction),
        };
        committedEntity = transactionEntity;
        parseOrThrow(KvSchema, transactionEntity);
        // Quota accounting joins the same write transaction: the usage check
        // is atomic with the data write, so racing writers cannot jointly
        // over-admit past the caps. Usage is derived from the live rows in
        // scope rather than a synchronized counter row (see `StorageQuota`).
        const quota = options.quota;
        if (quota !== undefined && name.startsWith(quota.prefix)) {
            const usage = await readQuotaUsage(targetDb, quota, {
                name,
                value: transactionEntity.value,
            });
            if (usage.bytes > quota.maxBytes || usage.keys > quota.maxKeys) {
                throw quotaExceededError();
            }
        }
        // Recheck authority after the awaits above and before mutation: a
        // cancellation that lands during the quota read must abort the
        // transaction instead of committing a write its authority died for.
        throwIfRevoked(options);
        await dbTry(
            () => targetDb.kv.put(transactionEntity),
            { op: 'write', entity: 'kv', action: 'upsertByName' },
            { rethrow: true }
        );
        await hooks.doAction('db.kv.upsertByName:action:after', transactionEntity);
        throwIfRevoked(options);
    });
    return committedEntity;
}

/**
 * Purpose:
 * Hard delete a KV record by name.
 *
 * Behavior:
 * Looks up the record by name, then deletes it with hooks.
 *
 * Constraints:
 * - No-op if the record does not exist.
 *
 * Non-Goals:
 * - Does not delete related data keyed by the KV value.
 */
export async function hardDeleteKvByName(
    name: string,
    targetDb: Or3DB = getDb(),
    guard?: StorageMutationGuard
): Promise<void> {
    throwIfRevoked(guard);
    await ensureDbOpen(targetDb);
    throwIfRevoked(guard);
    const hooks = useHooks();
    const existing = await dbTry(
        () => targetDb.kv.where('name').equals(name).first(),
        { op: 'read', entity: 'kv', action: 'getByName' }
    );
    throwIfRevoked(guard);
    if (!existing) return;
    await targetDb.transaction(
        'rw',
        getWriteTxTableNames(targetDb, 'kv', { includeTombstones: true }),
        async () => {
            // Same revocation boundary as writes: no delete after authority died.
            throwIfRevoked(guard);
            await hooks.doAction('db.kv.deleteByName:action:hard:before', {
                entity: existing,
                id: existing.id,
                tableName: 'kv',
            });
            throwIfRevoked(guard);
            await dbTry(
                () => targetDb.kv.delete(existing.id),
                { op: 'write', entity: 'kv', action: 'deleteByName' },
                { rethrow: true }
            );
            await hooks.doAction('db.kv.deleteByName:action:hard:after', {
                entity: existing,
                id: existing.id,
                tableName: 'kv',
            });
            throwIfRevoked(guard);
        }
    );
}

/**
 * Purpose:
 * Delete a KV record by name while preserving its revision chain.
 *
 * Behavior:
 * Replaces the row with a tombstone (`deleted: true`, value null) and a
 * bumped clock instead of physically removing it. The next write continues
 * past the tombstone clock, so a stale pre-delete revision can never match
 * a recreated incarnation (no ABA). Sync captures the tombstone put as a
 * soft delete, the same terminal state a physical delete produces.
 *
 * Constraints:
 * - No-op if the record does not exist or is already tombstoned.
 * - Readers must treat `deleted` rows as absent.
 *
 * Non-Goals:
 * - Not a replacement for `hardDeleteKvByName` elsewhere; other callers keep
 *   physical-delete semantics.
 */
export async function tombstoneKvByName(
    name: string,
    targetDb: Or3DB = getDb(),
    guard?: StorageMutationGuard
): Promise<void> {
    throwIfRevoked(guard);
    await ensureDbOpen(targetDb);
    throwIfRevoked(guard);
    const hooks = useHooks();
    // Fast refusal outside the transaction only; the authoritative state is
    // re-read inside it below.
    const { row: outer } = await readKvRevisionState(targetDb, name);
    throwIfRevoked(guard);
    if (!outer || outer.deleted) return;
    const now = nowSec();
    await targetDb.transaction(
        'rw',
        getWriteTxTableNames(targetDb, 'kv', { includeTombstones: true }),
        async () => {
            throwIfRevoked(guard);
            // Re-read inside the write transaction and repeat the
            // absent/deleted check: concurrent deletes must not both derive
            // the deletion from the same pre-transaction row, and a concurrent
            // update must not have its clock skipped. Revision comes only
            // from this in-transaction head; quota release is implicit,
            // because usage is derived from the live rows that remain.
            const { row: current, clock: currentClock } = await readKvRevisionState(
                targetDb,
                name
            );
            if (!current || current.deleted) return;
            throwIfRevoked(guard);
            await hooks.doAction('db.kv.deleteByName:action:hard:before', {
                entity: current,
                id: current.id,
                tableName: 'kv',
            });
            throwIfRevoked(guard);
            const tombstone: Kv = {
                ...current,
                value: null,
                deleted: true,
                updated_at: now,
                clock: nextClock(currentClock),
            };
            parseOrThrow(KvSchema, tombstone);
            // Recheck authority after the awaits above and before mutation:
            // a cancellation that lands during the re-read or hook must abort
            // the transaction instead of committing the delete.
            throwIfRevoked(guard);
            await dbTry(
                () => targetDb.kv.put(tombstone),
                { op: 'write', entity: 'kv', action: 'deleteByName' },
                { rethrow: true }
            );
            await hooks.doAction('db.kv.deleteByName:action:hard:after', {
                entity: current,
                id: current.id,
                tableName: 'kv',
            });
            throwIfRevoked(guard);
        }
    );
}
