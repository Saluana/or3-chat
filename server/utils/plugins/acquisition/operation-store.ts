/**
 * @module server/utils/plugins/acquisition/operation-store
 *
 * Purpose:
 * Durable, revision-checked operation records for plugin acquisition. One record
 * is the single source of truth for retry, cancel, status and crash recovery, so
 * a restart resumes from recorded evidence instead of guessing from the
 * filesystem.
 *
 * Behavior:
 * - Records are JSON files under `<extensions>/.operations/<operationId>.json`,
 *   written atomically (temp file → fsync → rename → directory fsync), exactly
 *   like the package pointer store.
 * - Every update is a compare-and-swap on the recorded revision, taken under an
 *   exclusive store lock, so two admins (or two processes) cannot silently
 *   overwrite each other's progress.
 * - A terminal record is immutable except for a retry, and a retry clears the
 *   failure and increments `attempts` rather than starting a new record.
 * - At most one active operation per plugin is allowed, and at most one runner
 *   advances a plugin at a time: both invariants are enforced with exclusive lock
 *   files, so two requests (or two processes) cannot interleave a download, a
 *   promotion or a retry.
 *
 * Constraints:
 * - No network, no plugin code. Secrets and signed URLs are never persisted.
 *
 * Non-Goals:
 * - Deciding what a stage means (the acquisition service owns the pipeline).
 */

import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';
import {
    PLUGIN_ACQUISITION_STAGES,
    acquisitionStageIndex,
    isActiveAcquisitionStatus,
    isTerminalAcquisitionStatus,
    type PluginAcquisitionOperation,
    type PluginAcquisitionReleaseIdentity,
    type PluginAcquisitionStage,
    type PluginAcquisitionStatus,
} from '~~/shared/plugins/acquisition/contracts';

export type OperationStoreErrorCode =
    | 'operation-not-found'
    | 'operation-invalid'
    | 'operation-conflict'
    | 'operation-id-invalid'
    | 'operation-directory-unavailable';

/** Lock files are held for one mutation or one pipeline run, never longer. */
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

export class PluginAcquisitionOperationError extends Error {
    constructor(
        readonly code: OperationStoreErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'PluginAcquisitionOperationError';
    }
}

const OPERATION_ID_PATTERN = /^acq_[a-z0-9]{8,64}$/;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
/** Bounded history: a runaway loop cannot grow the operations directory forever. */
export const MAX_OPERATION_RECORDS_PER_PLUGIN = 20;

/** The mutable subset of a record. Identity and creation data are immutable. */
export interface AcquisitionOperationPatch {
    readonly stage?: PluginAcquisitionStage;
    readonly status?: PluginAcquisitionStatus;
    readonly failure?: PluginAcquisitionOperation['failure'];
    readonly release?: PluginAcquisitionReleaseIdentity;
    readonly candidateDigest?: Sha256 | null;
    readonly expectedPointerRevision?: number | null;
    readonly setupRevision?: number | null;
    readonly authoritySha256?: Sha256;
    readonly acceptedAdvisorySequence?: number;
    readonly downloadedBytes?: number;
    readonly stagingObject?: string | null;
    readonly downloadUrlExpiresAt?: number | null;
    readonly attempts?: number;
    readonly cancelRequested?: boolean;
    readonly completedAt?: number | null;
    /**
     * Explicitly move a recorded stage backwards. Only the invalidation paths
     * use it (stale canary evidence or a changed preflight must re-run the
     * stages that produced the evidence), and it never moves to an earlier
     * stage than the recorded evidence still supports by itself.
     */
    readonly restage?: PluginAcquisitionStage;
}

export interface CreateOperationInput {
    readonly operationId?: string;
    readonly pluginId: string;
    readonly version: string;
    readonly workspaceId: string;
    readonly requesterUserId: string;
    readonly instanceId: string;
    readonly release: PluginAcquisitionReleaseIdentity;
    /**
     * Stage the record starts at. Resolution is read-only and happens before the
     * record exists, so a start created straight from resolved metadata records
     * `resolved` rather than claiming work that never needed durability.
     */
    readonly stage?: PluginAcquisitionStage;
    readonly acceptedAdvisorySequence?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a persisted record. A record that cannot be validated is treated as
 * absent by read paths (and reported as invalid by strict callers) rather than
 * half-applied.
 */
export function parseAcquisitionOperation(value: unknown): PluginAcquisitionOperation | null {
    if (!isRecord(value)) return null;
    if (value.schemaVersion !== 1) return null;
    if (typeof value.operationId !== 'string' || !OPERATION_ID_PATTERN.test(value.operationId)) return null;
    if (typeof value.pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(value.pluginId)) return null;
    if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
        return null;
    }
    if (typeof value.stage !== 'string' || typeof value.status !== 'string') return null;
    if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return null;
    if (!isRecord(value.release)) return null;
    return value as unknown as PluginAcquisitionOperation;
}

function assertPluginId(pluginId: string): void {
    if (!PLUGIN_ID_PATTERN.test(pluginId) || pluginId.includes('..')) {
        throw new PluginAcquisitionOperationError('operation-invalid', `Invalid plugin id: ${pluginId}`);
    }
}

function isInside(root: string, candidate: string): boolean {
    return candidate.startsWith(`${root}${sep}`);
}

export class PluginAcquisitionOperationStore {
    readonly #root: string;
    readonly #now: () => number;

    constructor(root = EXTENSIONS_BASE_DIR, now: () => number = () => Date.now()) {
        this.#root = resolve(root, '.operations');
        this.#now = now;
    }

    operationsDirectory(): string {
        return this.#root;
    }

    #operationPath(operationId: string): string {
        if (!OPERATION_ID_PATTERN.test(operationId)) {
            throw new PluginAcquisitionOperationError(
                'operation-id-invalid',
                `Invalid operation id: ${operationId}`
            );
        }
        const path = resolve(this.#root, `${operationId}.json`);
        if (!isInside(this.#root, path)) {
            throw new PluginAcquisitionOperationError('operation-id-invalid', 'Operation id escapes the store');
        }
        return path;
    }

    #stagingDir(operationId: string): string {
        this.#operationPath(operationId);
        return resolve(this.#root, 'staging', operationId);
    }

    async #ensureDirectory(): Promise<void> {
        await fs.mkdir(this.#root, { recursive: true, mode: 0o700 });
    }

    /**
     * Take an exclusive lock file. The lock is a file created with `O_EXCL`, so
     * it is atomic across processes and it cannot be fooled by a torn write. A
     * lock older than the stale window is assumed abandoned (a crashed process
     * cannot release its own lock) and is replaced.
     */
    async #acquire(path: string, staleMs: number, waitMs: number): Promise<() => Promise<void>> {
        await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const deadline = Date.now() + waitMs;
        for (;;) {
            try {
                const handle = await fs.open(path, 'wx', 0o600);
                try {
                    await handle.writeFile(String(process.pid), 'utf8');
                } finally {
                    await handle.close();
                }
                return async () => {
                    await fs.rm(path, { force: true }).catch(() => undefined);
                };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                try {
                    const stat = await fs.stat(path);
                    if (Date.now() - stat.mtimeMs > staleMs) {
                        await fs.rm(path, { force: true }).catch(() => undefined);
                        continue;
                    }
                } catch {
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new PluginAcquisitionOperationError(
                        'operation-conflict',
                        'The acquisition store is busy; retry shortly.'
                    );
                }
                await new Promise((resolveWait) => setTimeout(resolveWait, 10 + Math.floor(Math.random() * 20)));
            }
        }
    }

    #withLock<T>(fn: () => Promise<T>): Promise<T> {
        return this.#under(this.#lockPath(), fn);
    }

    async #under<T>(path: string, fn: () => Promise<T>): Promise<T> {
        const release = await this.#acquire(path, LOCK_STALE_MS, LOCK_WAIT_MS);
        try {
            return await fn();
        } finally {
            await release();
        }
    }

    #lockPath(): string {
        return resolve(this.#root, '.lock');
    }

    #runnerLockPath(pluginId: string): string {
        assertPluginId(pluginId);
        return resolve(this.#root, 'runners', `${pluginId}.lock`);
    }

    /**
     * Run one pipeline for a plugin, holding a per-plugin runner lock. A second
     * runner (another request, tab or process) is refused rather than allowed to
     * advance the same staging bytes, and a retry of a crashed run can proceed
     * once the stale lock is replaced.
     */
    async withRunnerLock<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
        return await this.#under(this.#runnerLockPath(pluginId), fn);
    }

    /** Whether a runner currently holds the plugin's pipeline lock. */
    async isRunnerActive(pluginId: string): Promise<boolean> {
        const path = this.#runnerLockPath(pluginId);
        try {
            const stat = await fs.stat(path);
            return Date.now() - stat.mtimeMs <= LOCK_STALE_MS;
        } catch {
            return false;
        }
    }

    async #write(record: PluginAcquisitionOperation, exclusive = false): Promise<void> {
        await this.#ensureDirectory();
        const target = this.#operationPath(record.operationId);
        const temporary = resolve(this.#root, `.${record.operationId}.${randomUUID()}.tmp`);
        if (exclusive) {
            // A new record is created with O_EXCL: an existing file means another
            // creator won, which is a conflict, not an overwrite.
            let handle;
            try {
                handle = await fs.open(target, 'wx', 0o600);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                    throw new PluginAcquisitionOperationError(
                        'operation-conflict',
                        `Operation ${record.operationId} already exists.`
                    );
                }
                throw error;
            }
            try {
                await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }
            await this.#fsyncDirectory();
            return;
        }
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.rename(temporary, target);
        await this.#fsyncDirectory();
    }

    async #fsyncDirectory(): Promise<void> {
        const directory = await fs.open(this.#root, constants.O_RDONLY);
        try {
            await directory.sync();
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
        } finally {
            await directory.close();
        }
    }

    async read(operationId: string): Promise<PluginAcquisitionOperation | null> {
        const path = this.#operationPath(operationId);
        let raw: string;
        try {
            const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > 256 * 1024) return null;
                raw = await handle.readFile('utf8');
            } finally {
                await handle.close();
            }
        } catch {
            return null;
        }
        try {
            return parseAcquisitionOperation(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    /** Strict read: a corrupt record is an error, not a silent absence. */
    async requireRecord(operationId: string): Promise<PluginAcquisitionOperation> {
        const record = await this.read(operationId);
        if (!record) {
            throw new PluginAcquisitionOperationError(
                'operation-not-found',
                `No acquisition operation ${operationId} is recorded.`
            );
        }
        return record;
    }

    async list(pluginId?: string): Promise<readonly PluginAcquisitionOperation[]> {
        await this.#ensureDirectory();
        let entries: string[];
        try {
            entries = await fs.readdir(this.#root);
        } catch {
            return [];
        }
        const records: PluginAcquisitionOperation[] = [];
        for (const entry of entries) {
            // Only operation records are read here. Anything else the directory
            // holds (locks, staging, registry state) is not an operation, and a
            // file that merely ends in `.json` must not fail enumeration.
            if (!entry.endsWith('.json') || entry.startsWith('.')) continue;
            const operationId = entry.slice(0, -'.json'.length);
            if (!OPERATION_ID_PATTERN.test(operationId)) continue;
            const record = await this.read(operationId);
            if (!record) continue;
            if (pluginId === undefined || record.pluginId === pluginId) records.push(record);
        }
        return records.sort((left, right) => right.createdAt - left.createdAt);
    }

    /** The active operation for a plugin, if one exists. */
    async findActiveForPlugin(pluginId: string): Promise<PluginAcquisitionOperation | null> {
        assertPluginId(pluginId);
        const records = await this.list(pluginId);
        return records.find((record) => isActiveAcquisitionStatus(record.status)) ?? null;
    }

    async create(input: CreateOperationInput): Promise<PluginAcquisitionOperation> {
        assertPluginId(input.pluginId);
        const now = this.#now();
        const stage = input.stage ?? 'requested';
        if (!PLUGIN_ACQUISITION_STAGES.includes(stage)) {
            throw new PluginAcquisitionOperationError(
                'operation-invalid',
                `Unknown acquisition stage: ${stage}`
            );
        }
        const record: PluginAcquisitionOperation = {
            schemaVersion: 1,
            operationId: input.operationId ?? `acq_${randomUUID().replace(/-/g, '')}`,
            revision: 1,
            pluginId: input.pluginId,
            version: input.version,
            workspaceId: input.workspaceId,
            requesterUserId: input.requesterUserId,
            instanceId: input.instanceId,
            release: input.release,
            stage,
            status: 'pending',
            failure: null,
            candidateDigest: null,
            expectedPointerRevision: null,
            setupRevision: null,
            authoritySha256: input.release.authoritySha256,
            acceptedAdvisorySequence: input.acceptedAdvisorySequence ?? 0,
            downloadedBytes: 0,
            stagingObject: null,
            downloadUrlExpiresAt: null,
            attempts: 0,
            cancelRequested: false,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        };
        return await this.#withLock(async () => {
            // The active-operation check and the write share one critical
            // section, so two concurrent starts cannot both observe "no active
            // operation" and both create one.
            const active = await this.findActiveForPlugin(input.pluginId);
            if (active) {
                throw new PluginAcquisitionOperationError(
                    'operation-conflict',
                    `Operation ${active.operationId} is already in progress for ${input.pluginId}.`
                );
            }
            await this.#write(record, true);
            return record;
        });
    }

    /**
     * Compare-and-swap update. The caller's `expectedRevision` must match the
     * recorded revision; the read, the comparison and the write happen under the
     * store lock, so a concurrent writer cannot slip between them.
     */
    async update(
        operationId: string,
        expectedRevision: number,
        patch: AcquisitionOperationPatch
    ): Promise<PluginAcquisitionOperation> {
        return await this.#withLock(async () =>
            await this.#updateUnlocked(operationId, expectedRevision, patch)
        );
    }

    async #updateUnlocked(
        operationId: string,
        expectedRevision: number,
        patch: AcquisitionOperationPatch
    ): Promise<PluginAcquisitionOperation> {
        {
            const current = await this.requireRecord(operationId);
            if (current.revision !== expectedRevision) {
                throw new PluginAcquisitionOperationError(
                    'operation-conflict',
                    `Operation ${operationId} moved from revision ${expectedRevision} to ${current.revision}.`
                );
            }
            const now = this.#now();
            const next: PluginAcquisitionOperation = {
                ...current,
                ...(patch.stage === undefined ? {} : { stage: patch.stage }),
                ...(patch.restage === undefined ? {} : { stage: patch.restage }),
                ...(patch.status === undefined ? {} : { status: patch.status }),
                ...(patch.failure === undefined ? {} : { failure: patch.failure }),
                ...(patch.release === undefined ? {} : { release: patch.release }),
                ...(patch.candidateDigest === undefined ? {} : { candidateDigest: patch.candidateDigest }),
                ...(patch.expectedPointerRevision === undefined
                    ? {}
                    : { expectedPointerRevision: patch.expectedPointerRevision }),
                ...(patch.setupRevision === undefined ? {} : { setupRevision: patch.setupRevision }),
                ...(patch.authoritySha256 === undefined ? {} : { authoritySha256: patch.authoritySha256 }),
                ...(patch.acceptedAdvisorySequence === undefined
                    ? {}
                    : { acceptedAdvisorySequence: patch.acceptedAdvisorySequence }),
                ...(patch.downloadedBytes === undefined ? {} : { downloadedBytes: patch.downloadedBytes }),
                ...(patch.stagingObject === undefined ? {} : { stagingObject: patch.stagingObject }),
                ...(patch.downloadUrlExpiresAt === undefined
                    ? {}
                    : { downloadUrlExpiresAt: patch.downloadUrlExpiresAt }),
                ...(patch.attempts === undefined ? {} : { attempts: patch.attempts }),
                ...(patch.cancelRequested === undefined ? {} : { cancelRequested: patch.cancelRequested }),
                ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
                revision: current.revision + 1,
                updatedAt: now,
            };
            if (patch.restage !== undefined) {
                if (
                    acquisitionStageIndex(patch.restage) >= acquisitionStageIndex(current.stage) ||
                    !PLUGIN_ACQUISITION_STAGES.includes(patch.restage)
                ) {
                    throw new PluginAcquisitionOperationError(
                        'operation-invalid',
                        `Operation ${operationId} cannot restage from ${current.stage} to ${patch.restage}.`
                    );
                }
            }
            if (isTerminalAcquisitionStatus(current.status) && !isTerminalAcquisitionStatus(next.status)) {
                // A terminal operation only restarts through `retry`.
                if (next.status !== 'pending' || patch.attempts === undefined) {
                    throw new PluginAcquisitionOperationError(
                        'operation-conflict',
                        `Operation ${operationId} is ${current.status} and can only be retried.`
                    );
                }
            }
            await this.#write(next);
            if (isTerminalAcquisitionStatus(next.status) && !next.failure?.retryable) {
                // A run that ended for good keeps no staged bytes: only a
                // retryable stop may still need its staging to resume.
                await this.#removeStaging(operationId);
            }
            return next;
        }
    }

    /**
     * Retry a failed or blocked operation: keeps the identity and stage, clears
     * the failure, and records that another attempt is beginning. Another active
     * operation for the plugin, or a live runner on this one, refuses the retry
     * instead of letting two runs share one staging directory.
     */
    async retry(operationId: string): Promise<PluginAcquisitionOperation> {
        return await this.#withLock(async () => {
            const current = await this.requireRecord(operationId);
            if (current.status === 'completed') {
                throw new PluginAcquisitionOperationError(
                    'operation-conflict',
                    `Operation ${operationId} already completed.`
                );
            }
            if (current.status === 'canceled' && !current.cancelRequested) {
                throw new PluginAcquisitionOperationError(
                    'operation-conflict',
                    `Operation ${operationId} was canceled.`
                );
            }
            const other = (await this.list(current.pluginId)).find(
                (candidate) =>
                    candidate.operationId !== current.operationId &&
                    isActiveAcquisitionStatus(candidate.status)
            );
            if (other) {
                throw new PluginAcquisitionOperationError(
                    'operation-conflict',
                    `Operation ${other.operationId} is already in progress for ${current.pluginId}.`
                );
            }
            if (isActiveAcquisitionStatus(current.status) && (await this.isRunnerActive(current.pluginId))) {
                throw new PluginAcquisitionOperationError(
                    'operation-conflict',
                    `Operation ${operationId} is already being run.`
                );
            }
            return await this.#updateUnlocked(operationId, current.revision, {
                status: 'pending',
                failure: null,
                cancelRequested: false,
                attempts: current.attempts + 1,
                completedAt: null,
            });
        });
    }

    /**
     * Request cancellation. The pipeline checks this flag before every side
     * effect, so cancellation is observed between stages rather than mid-write.
     */
    async requestCancel(operationId: string): Promise<PluginAcquisitionOperation> {
        return await this.#withLock(async () => {
            const current = await this.requireRecord(operationId);
            if (isTerminalAcquisitionStatus(current.status)) return current;
            return await this.#updateUnlocked(operationId, current.revision, {
                cancelRequested: true,
            });
        });
    }

    /** Remove the staged bytes of one operation; safe when there are none. */
    async removeStaging(operationId: string): Promise<void> {
        await this.#removeStaging(operationId);
    }

    async #removeStaging(operationId: string): Promise<void> {
        await fs
            .rm(this.#stagingDir(operationId), { recursive: true, force: true })
            .catch(() => undefined);
    }

    /** Retention: keep the newest `keep` runs per plugin, terminal first. */
    async gc(keep = MAX_OPERATION_RECORDS_PER_PLUGIN): Promise<number> {
        return await this.#withLock(async () => {
            const records = await this.list();
            const byPlugin = new Map<string, PluginAcquisitionOperation[]>();
            for (const record of records) {
                const bucket = byPlugin.get(record.pluginId) ?? [];
                bucket.push(record);
                byPlugin.set(record.pluginId, bucket);
            }
            let removed = 0;
            for (const bucket of byPlugin.values()) {
                // Never garbage-collect an active run.
                const active = bucket.filter((record) => isActiveAcquisitionStatus(record.status));
                const terminal = bucket
                    .filter((record) => !isActiveAcquisitionStatus(record.status))
                    .sort((left, right) => right.createdAt - left.createdAt);
                const excess = [...active, ...terminal].slice(keep);
                for (const record of excess) {
                    if (isActiveAcquisitionStatus(record.status)) continue;
                    try {
                        await fs.rm(this.#operationPath(record.operationId));
                        await this.#removeStaging(record.operationId);
                        removed += 1;
                    } catch {
                        // Already gone.
                    }
                }
            }
            return removed;
        });
    }
}
