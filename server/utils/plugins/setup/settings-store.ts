/**
 * Saved setup settings for one plugin in one workspace.
 *
 * Values are the user's data, not the plugin's, and they are scoped to the
 * exact package digest they were written for. Preparing an update therefore
 * writes the pending candidate's settings under its own digest and never
 * touches the document the running version reads; promotion commits the pair by
 * swapping the pointer, and a canceled or failed operation leaves the running
 * version's settings untouched. Values saved before scoping live under the
 * unscoped key, which remains a read fallback so upgrades inherit them.
 */

import type { H3Event } from 'h3';
import { z } from 'zod';
import type { WorkspaceSettingsStore } from '../../../admin/stores/types';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';

/** Unscoped document, kept as the read fallback for values saved before scoping. */
export function setupValuesKey(pluginId: string): string {
    return `plugin:${pluginId}:setup-values`;
}

/** Digest-scoped document: one saved configuration per exact package. */
export function scopedSetupValuesKey(pluginId: string, packageDigest: string): string {
    return `plugin:${pluginId}:setup-values.${packageDigest}`;
}

/** Candidate overlay key; each acquisition owns an independent document. */
export function operationScopedSetupValuesKey(
    pluginId: string,
    packageDigest: string,
    operationId: string
): string {
    return `${scopedSetupValuesKey(pluginId, packageDigest)}.operation.${operationId}`;
}

// A provider-neutral rollback marker is used where the settings contract has
// no delete operation. Reads ignore it, and a later write can atomically take
// the digest record over without inheriting failed candidate values.
const SETUP_ROLLBACK_MARKER = '__or3_setup_rollback__';

const ScopedSetupValuesSchema = z
    .object({
        schemaVersion: z.literal(1),
        pluginId: z.string().min(1).max(128),
        packageDigest: z.string().min(1).max(128),
        operationId: z.string().min(1).max(128).nullable(),
        revision: z.number().int().min(1),
        values: z.record(z.string(), z.unknown()),
    })
    .strict();

export interface SetupValuesScope {
    /** Exact package the values belong to. */
    readonly packageDigest: string;
    /** Acquisition operation whose candidate this configuration prepared. */
    readonly operationId?: string | null;
    /** Currently selected package to seed a new candidate from. */
    readonly basePackageDigest?: string | null;
}

export interface SetupValuesRecord {
    readonly values: Record<string, unknown>;
    readonly revision: number;
    readonly operationId: string | null;
}

export interface SetupValuesPatchResult {
    readonly values: Readonly<Record<string, unknown>>;
    readonly revision: number;
}

/**
 * One coherent settings read: the values in effect and the revision a form
 * must send to save against exactly those values. Both come from the same
 * document so a concurrent write cannot pair stale values with a newer
 * revision.
 */
export interface SetupValuesSnapshot {
    readonly values: Record<string, unknown>;
    readonly revision: number;
}

/** Raised when a save expected a revision another writer already replaced. */
export class SetupValuesRevisionConflictError extends Error {
    constructor(
        readonly expectedRevision: number,
        readonly actualRevision: number
    ) {
        super('Setup values changed since they were loaded');
        this.name = 'SetupValuesRevisionConflictError';
    }
}

/** Raised when a prepared setup record could not be restored atomically. */
export class SetupPromotionRollbackError extends Error {
    constructor() {
        super('Setup promotion rollback lost a concurrent settings write');
        this.name = 'SetupPromotionRollbackError';
    }
}

/**
 * Candidate setup writes are serialized per workspace/plugin/digest. The
 * backing WorkspaceSettingsStore may be remote and can expose a real CAS via
 * its provider, but the host still needs a process-local critical section for
 * providers that implement the small key/value contract only. The revision is
 * checked while this lock is held, so two concurrent requests in one host
 * process cannot both accept the same revision.
 */
const setupWriteTails = new Map<string, Promise<unknown>>();

async function withSetupWriteLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = setupWriteTails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    setupWriteTails.set(key, tail);
    try {
        return await next;
    } finally {
        if (setupWriteTails.get(key) === tail) setupWriteTails.delete(key);
    }
}

function parseScoped(raw: string | null): SetupValuesRecord | null {
    if (!raw) return null;
    try {
        const parsed = ScopedSetupValuesSchema.safeParse(JSON.parse(raw) as unknown);
        if (!parsed.success) return null;
        return {
            values: parsed.data.values,
            revision: parsed.data.revision,
            operationId: parsed.data.operationId,
        };
    } catch {
        return null;
    }
}

function parseUnscoped(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return {};
    }
    return {};
}

/** Reads the digest-scoped record; a corrupt value reads as absent, not half-applied. */
export async function readScopedSetupValues(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    packageDigest: string,
    operationId?: string | null
): Promise<SetupValuesRecord | null> {
    const key = operationId
        ? operationScopedSetupValuesKey(pluginId, packageDigest, operationId)
        : scopedSetupValuesKey(pluginId, packageDigest);
    const parsed = parseScoped(await store.get(workspaceId, key));
    if (!operationId && parsed?.operationId === SETUP_ROLLBACK_MARKER) return null;
    return parsed;
}

function setupWriteLockKey(
    workspaceId: string,
    pluginId: string,
    scope: SetupValuesScope
): string {
    return `${workspaceId}\u0000${pluginId}\u0000${scope.packageDigest}\u0000${scope.operationId ?? 'current'}`;
}

function setupValuesDocumentKey(pluginId: string, scope: SetupValuesScope): string {
    return scope.operationId
        ? operationScopedSetupValuesKey(pluginId, scope.packageDigest, scope.operationId)
        : scopedSetupValuesKey(pluginId, scope.packageDigest);
}

/**
 * Persist the parsed document for one scope from the exact raw value it was
 * read from. Returns true when this writer won; false tells the caller to
 * reread (a concurrent writer changed the document).
 */
async function writeScopedDocument(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    key: string,
    currentRaw: string | null,
    nextValue: string
): Promise<boolean> {
    if (store.compareAndSet) {
        return await store.compareAndSet(workspaceId, key, currentRaw, nextValue);
    }
    await store.set(workspaceId, key, nextValue);
    return true;
}

/**
 * Writes the digest-scoped record, incrementing its revision. When the caller
 * supplies the revision it loaded, a concurrent save is refused instead of
 * silently overwritten.
 */
export async function writeScopedSetupValues(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    scope: SetupValuesScope,
    values: Readonly<Record<string, unknown>>,
    expectedRevision?: number
): Promise<number> {
    return await withSetupWriteLock(
        setupWriteLockKey(workspaceId, pluginId, scope),
        async () => {
            const key = setupValuesDocumentKey(pluginId, scope);
            const currentRaw = await store.get(workspaceId, key);
            const parsed = parseScoped(currentRaw);
            const existing = parsed?.operationId === SETUP_ROLLBACK_MARKER ? null : parsed;
            const actual = existing?.revision ?? 0;
            if (expectedRevision !== undefined && expectedRevision !== actual) {
                throw new SetupValuesRevisionConflictError(expectedRevision, actual);
            }
            // A candidate overlay belongs to one durable acquisition. Its key
            // already contains that operation id, so a canceled operation can
            // never block a later operation for the same immutable package.
            const requestedOperation = scope.operationId ?? null;
            if (scope.operationId && existing && existing.operationId !== requestedOperation) {
                throw new SetupValuesRevisionConflictError(actual, actual);
            }
            const revision = actual + 1;
            const nextValue = JSON.stringify({
                schemaVersion: 1,
                pluginId,
                packageDigest: scope.packageDigest,
                operationId: requestedOperation,
                revision,
                values,
            });
            const updated = await writeScopedDocument(
                store,
                workspaceId,
                key,
                currentRaw,
                nextValue
            );
            if (!updated) {
                const latest = await readScopedSetupValues(
                    store,
                    workspaceId,
                    pluginId,
                    scope.packageDigest,
                    scope.operationId
                );
                throw new SetupValuesRevisionConflictError(
                    expectedRevision ?? actual,
                    latest?.revision ?? 0
                );
            }
            return revision;
        }
    );
}

/**
 * Seeds the merge base for a scope whose target document is absent, mirroring
 * `readSetupValuesFor` exactly: the retained target-digest record (a reinstall
 * keeps the package's saved configuration), then the running digest's record,
 * then legacy unscoped values. A corrupt document in any scope reads as empty
 * rather than falling through; a promotion rollback marker falls through.
 */
async function readWriteBaseValues(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    scope: SetupValuesScope
): Promise<Record<string, unknown>> {
    if (scope.operationId) {
        const retainedRaw = await store.get(
            workspaceId,
            scopedSetupValuesKey(pluginId, scope.packageDigest)
        );
        if (retainedRaw !== null) {
            const retained = parseScoped(retainedRaw);
            if (retained?.operationId !== SETUP_ROLLBACK_MARKER) {
                return retained ? retained.values : {};
            }
        }
    }
    const baseDigest = scope.basePackageDigest ?? null;
    if (baseDigest && baseDigest !== scope.packageDigest) {
        const baseRaw = await store.get(
            workspaceId,
            scopedSetupValuesKey(pluginId, baseDigest)
        );
        if (baseRaw !== null) {
            const base = parseScoped(baseRaw);
            return base ? base.values : {};
        }
    }
    return parseUnscoped(await store.get(workspaceId, setupValuesKey(pluginId)));
}

/**
 * Undo a just-written document after a commit guard refused it: a revocation
 * that landed while the compare-and-set was in flight must not leave the write
 * behind. Mirrors `promoteScopedSetupValues`: the previous raw document (or a
 * rollback marker when none existed) is restored, and a non-CAS provider only
 * restores when the exact written value is still present.
 */
async function restoreRefusedCommit(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    scope: SetupValuesScope,
    key: string,
    expectedRaw: string | null,
    writtenRaw: string
): Promise<void> {
    const restoreRaw =
        expectedRaw ??
        JSON.stringify({
            schemaVersion: 1,
            pluginId,
            packageDigest: scope.packageDigest,
            operationId: SETUP_ROLLBACK_MARKER,
            revision: 1,
            values: {},
        });
    if (store.compareAndSet) {
        await store.compareAndSet(workspaceId, key, writtenRaw, restoreRaw);
        return;
    }
    if ((await store.get(workspaceId, key)) === writtenRaw) {
        await store.set(workspaceId, key, restoreRaw);
    }
}

/**
 * Patch-style write. The transform runs inside the same compare-and-set retry
 * loop as the read it is based on:
 *
 * 1. read the raw record,
 * 2. parse the current values (falling back to the seed base only when the
 *    document does not exist),
 * 3. apply and validate the patch through `transform`,
 * 4. run the optional commit guard,
 * 5. CAS from exactly the raw record read in step 1,
 * 6. run the commit guard again and undo the write if it now refuses,
 * 7. on conflict, reread and repeat so concurrent disjoint patches both land.
 *
 * A caller that supplied `expectedRevision` (a full form save) keeps the
 * explicit conflict instead of auto-merging.
 */
export async function patchScopedSetupValues(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    scope: SetupValuesScope,
    transform: (
        current: Readonly<Record<string, unknown>>
    ) => Readonly<Record<string, unknown>>,
    options: {
        readonly expectedRevision?: number;
        readonly maxAttempts?: number;
        /**
         * Synchronous live-authority check run on every attempt and again after
         * the write. It must throw to refuse the commit; a throw after the write
         * restores the previous document so revocation cannot be outrun.
         */
        readonly guard?: () => void;
    } = {}
): Promise<SetupValuesPatchResult> {
    return await withSetupWriteLock(
        setupWriteLockKey(workspaceId, pluginId, scope),
        async () => {
            const key = setupValuesDocumentKey(pluginId, scope);
            const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
            const requestedOperation = scope.operationId ?? null;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const currentRaw = await store.get(workspaceId, key);
                const parsed = parseScoped(currentRaw);
                const isRollbackMarker =
                    parsed?.operationId === SETUP_ROLLBACK_MARKER;
                const existing = isRollbackMarker ? null : parsed;
                const actual = existing?.revision ?? 0;
                if (
                    options.expectedRevision !== undefined &&
                    options.expectedRevision !== actual
                ) {
                    throw new SetupValuesRevisionConflictError(
                        options.expectedRevision,
                        actual
                    );
                }
                if (
                    scope.operationId &&
                    existing &&
                    existing.operationId !== requestedOperation
                ) {
                    throw new SetupValuesRevisionConflictError(actual, actual);
                }
                // A corrupt document is authoritative in its scope and must not
                // inherit another scope's values; only an absent document (or a
                // promotion rollback marker) seeds from the base.
                const currentValues = existing
                    ? existing.values
                    : currentRaw !== null && !isRollbackMarker
                      ? {}
                      : await readWriteBaseValues(store, workspaceId, pluginId, scope);
                const values = transform(currentValues);
                const revision = actual + 1;
                const nextValue = JSON.stringify({
                    schemaVersion: 1,
                    pluginId,
                    packageDigest: scope.packageDigest,
                    operationId: requestedOperation,
                    revision,
                    values,
                });
                options.guard?.();
                const updated = await writeScopedDocument(
                    store,
                    workspaceId,
                    key,
                    currentRaw,
                    nextValue
                );
                if (updated) {
                    if (options.guard) {
                        try {
                            options.guard();
                        } catch (error) {
                            await restoreRefusedCommit(
                                store,
                                workspaceId,
                                pluginId,
                                scope,
                                key,
                                currentRaw,
                                nextValue
                            );
                            throw error;
                        }
                    }
                    return { values, revision };
                }
                // A full form save must surface its conflict; a patch rereads
                // and reapplies so disjoint concurrent patches both survive.
                if (options.expectedRevision !== undefined) {
                    const latest = await readScopedSetupValues(
                        store,
                        workspaceId,
                        pluginId,
                        scope.packageDigest,
                        scope.operationId
                    );
                    throw new SetupValuesRevisionConflictError(
                        options.expectedRevision,
                        latest?.revision ?? 0
                    );
                }
            }
            const latest = await readScopedSetupValues(
                store,
                workspaceId,
                pluginId,
                scope.packageDigest,
                scope.operationId
            );
            throw new SetupValuesRevisionConflictError(
                options.expectedRevision ?? 0,
                latest?.revision ?? 0
            );
        }
    );
}

/**
 * Reads the values in effect for one package. A candidate first reads its
 * operation-owned overlay, then the currently selected digest's record, then
 * legacy unscoped values. Runtime/current reads never follow an operation
 * overlay.
 */
export async function readSetupValuesFor(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    scope?: {
        readonly packageDigest?: string | null;
        readonly operationId?: string | null;
        /** Currently selected package to seed a new candidate from. */
        readonly basePackageDigest?: string | null;
    }
): Promise<Record<string, unknown>> {
    const digest = scope?.packageDigest ?? null;
    if (digest) {
        if (scope?.operationId) {
            const operationRaw = await store.get(
                workspaceId,
                operationScopedSetupValuesKey(pluginId, digest, scope.operationId)
            );
            // An operation-owned document is authoritative even when corrupt,
            // so a damaged candidate can never silently inherit another value.
            if (operationRaw !== null) {
                const scoped = parseScoped(operationRaw);
                return scoped ? scoped.values : {};
            }
        }
        const currentRaw = await store.get(workspaceId, scopedSetupValuesKey(pluginId, digest));
        if (currentRaw !== null) {
            const current = parseScoped(currentRaw);
            if (current?.operationId !== SETUP_ROLLBACK_MARKER) {
                return current ? current.values : {};
            }
        }
        const baseDigest = scope?.basePackageDigest ?? null;
        if (baseDigest && baseDigest !== digest) {
            const baseRaw = await store.get(
                workspaceId,
                scopedSetupValuesKey(pluginId, baseDigest)
            );
            if (baseRaw !== null) {
                const base = parseScoped(baseRaw);
                return base ? base.values : {};
            }
        }
    }
    return parseUnscoped(await store.get(workspaceId, setupValuesKey(pluginId)));
}

/**
 * Read the values in effect and the target document's revision in one pass.
 * The revision is the one a form must send back (`expectedRevision`): it comes
 * from the operation overlay for candidate setup, otherwise from the target
 * digest's own record, and is 0 when that record is absent, corrupt or a
 * rollback marker — exactly what `readScopedSetupValues` would report.
 */
export async function readSetupValuesSnapshotFor(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    scope?: {
        readonly packageDigest?: string | null;
        readonly operationId?: string | null;
        readonly basePackageDigest?: string | null;
    }
): Promise<SetupValuesSnapshot> {
    const digest = scope?.packageDigest ?? null;
    const operationId = scope?.operationId ?? null;
    if (digest) {
        const targetKey = operationId
            ? operationScopedSetupValuesKey(pluginId, digest, operationId)
            : scopedSetupValuesKey(pluginId, digest);
        const targetRaw = await store.get(workspaceId, targetKey);
        const target = parseScoped(targetRaw);
        const targetUsable =
            targetRaw !== null && target?.operationId !== SETUP_ROLLBACK_MARKER;
        if (targetUsable) {
            return {
                values: target ? target.values : {},
                revision: target?.revision ?? 0,
            };
        }
        if (operationId) {
            const retainedRaw = await store.get(
                workspaceId,
                scopedSetupValuesKey(pluginId, digest)
            );
            const retained = parseScoped(retainedRaw);
            if (
                retainedRaw !== null &&
                retained?.operationId !== SETUP_ROLLBACK_MARKER
            ) {
                // Retained configuration for this exact package (for example
                // after a reinstall); the overlay has no revision yet.
                return { values: retained ? retained.values : {}, revision: 0 };
            }
        }
        const baseDigest = scope?.basePackageDigest ?? null;
        if (baseDigest && baseDigest !== digest) {
            const baseRaw = await store.get(
                workspaceId,
                scopedSetupValuesKey(pluginId, baseDigest)
            );
            if (baseRaw !== null) {
                const base = parseScoped(baseRaw);
                return { values: base ? base.values : {}, revision: 0 };
            }
        }
    }
    return {
        values: parseUnscoped(await store.get(workspaceId, setupValuesKey(pluginId))),
        revision: 0,
    };
}

/**
 * Commit the effective candidate configuration into the digest record used by
 * runtime/current reads. The operation overlay remains immutable history, so a
 * canceled operation cannot claim the next operation's writes. The provider
 * CAS protects the current record when promotion and a runtime save race.
 */
export async function promoteScopedSetupValues(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    packageDigest: string,
    operationId: string,
    basePackageDigest?: string | null
): Promise<(() => Promise<void>) | undefined> {
    const lockKey = `${workspaceId}\u0000${pluginId}\u0000${packageDigest}\u0000current`;
    return await withSetupWriteLock(lockKey, async () => {
        const operation = await readScopedSetupValues(
            store,
            workspaceId,
            pluginId,
            packageDigest,
            operationId
        );
        const currentKey = scopedSetupValuesKey(pluginId, packageDigest);
        const currentRaw = await store.get(workspaceId, currentKey);
        const current = parseScoped(currentRaw);
        if (!operation) {
            // Candidate forms may inherit the running package's digest record
            // or legacy values without creating an operation overlay first.
            const inherited = await readSetupValuesFor(store, workspaceId, pluginId, {
                packageDigest,
                operationId,
                ...(basePackageDigest === undefined ? {} : { basePackageDigest }),
            });
            if (current && current.operationId !== SETUP_ROLLBACK_MARKER) return undefined;
            return await writePromoted(currentRaw, inherited, 0);
        }
        return await writePromoted(
            currentRaw,
            operation.values,
            Math.max(current?.revision ?? 0, operation.revision)
        );

        async function writePromoted(
            expectedRaw: string | null,
            nextValues: Record<string, unknown>,
            sourceRevision: number
        ): Promise<(() => Promise<void>)> {
            const revision = Math.max(1, sourceRevision + 1);
            const nextValue = JSON.stringify({
                schemaVersion: 1,
                pluginId,
                packageDigest,
                operationId: null,
                revision,
                values: nextValues,
            });
            const updated = store.compareAndSet
                ? await store.compareAndSet(workspaceId, currentKey, expectedRaw, nextValue)
                : (await store.set(workspaceId, currentKey, nextValue), true);
            if (!updated) {
                const latest = await readScopedSetupValues(
                    store,
                    workspaceId,
                    pluginId,
                    packageDigest
                );
                if (
                    latest?.operationId === null &&
                    JSON.stringify(latest.values) === JSON.stringify(nextValues)
                ) {
                    return async () => undefined;
                }
                throw new SetupValuesRevisionConflictError(
                    current?.revision ?? 0,
                    latest?.revision ?? 0
                );
            }
            return async () => {
                // Do not erase a runtime save that legitimately won the race
                // after the pointer commit attempt. If the prepared value is
                // still present, restore the old record; when no old record
                // existed, leave an empty tombstone so a retry cannot inherit
                // the failed operation's values.
                const currentAfter = await store.get(workspaceId, currentKey);
                if (currentAfter !== nextValue) throw new SetupPromotionRollbackError();
                const restoreValue = expectedRaw ?? JSON.stringify({
                    schemaVersion: 1,
                    pluginId,
                    packageDigest,
                    operationId: SETUP_ROLLBACK_MARKER,
                    revision: 1,
                    values: {},
                });
                if (store.compareAndSet) {
                    const restored = await store.compareAndSet(
                        workspaceId,
                        currentKey,
                        nextValue,
                        restoreValue
                    );
                    if (!restored) throw new SetupPromotionRollbackError();
                } else if ((await store.get(workspaceId, currentKey)) === nextValue) {
                    await store.set(workspaceId, currentKey, restoreValue);
                }
            };
        }
    });
}

/** Event-bound read for the routes and the setup state loader. */
export async function readSetupValues(
    event: H3Event,
    workspaceId: string,
    pluginId: string,
    scope?: {
        readonly packageDigest?: string | null;
        readonly operationId?: string | null;
        readonly basePackageDigest?: string | null;
    }
): Promise<Record<string, unknown>> {
    return await readSetupValuesFor(
        getWorkspaceSettingsStore(event),
        workspaceId,
        pluginId,
        scope
    );
}

/** Event-bound coherent values+revision read; see `readSetupValuesSnapshotFor`. */
export async function readSetupValuesSnapshot(
    event: H3Event,
    workspaceId: string,
    pluginId: string,
    scope?: {
        readonly packageDigest?: string | null;
        readonly operationId?: string | null;
        readonly basePackageDigest?: string | null;
    }
): Promise<SetupValuesSnapshot> {
    return await readSetupValuesSnapshotFor(
        getWorkspaceSettingsStore(event),
        workspaceId,
        pluginId,
        scope
    );
}

/** Writes the unscoped document; only legacy extension directories use it. */
export async function writeUnscopedSetupValues(
    event: H3Event,
    workspaceId: string,
    pluginId: string,
    values: Readonly<Record<string, unknown>>
): Promise<void> {
    await getWorkspaceSettingsStore(event).set(
        workspaceId,
        setupValuesKey(pluginId),
        JSON.stringify(values)
    );
}

/** Event-bound patch write; see `patchScopedSetupValues` for the CAS contract. */
export async function patchSetupValues(
    event: H3Event,
    workspaceId: string,
    pluginId: string,
    scope: SetupValuesScope,
    transform: (
        current: Readonly<Record<string, unknown>>
    ) => Readonly<Record<string, unknown>>,
    options?: {
        readonly expectedRevision?: number;
        readonly maxAttempts?: number;
    }
): Promise<SetupValuesPatchResult> {
    return await patchScopedSetupValues(
        getWorkspaceSettingsStore(event),
        workspaceId,
        pluginId,
        scope,
        transform,
        options
    );
}
