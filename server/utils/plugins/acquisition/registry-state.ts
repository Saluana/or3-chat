/**
 * @module server/utils/plugins/acquisition/registry-state
 *
 * Purpose:
 * The small amount of durable state the acquisition track keeps about a registry:
 * the highest advisory sequence this host has accepted, and the quarantine
 * decisions it has seen for individual releases.
 *
 * Behavior:
 * - Monotonic: a lower sequence is refused, so a replayed catalog can never clear
 *   a revocation the host already saw.
 * - Quarantines are stored per release, separately from the sequence cursor. The
 *   cursor only measures freshness; filtering scoped decisions with it would let
 *   an unrelated release's advisory clear a quarantine.
 * - Atomic writes under `<extensions>/.registry/`, kept out of the operation
 *   directory so registry state can never be mistaken for an operation record,
 *   with the check-and-write taken under an exclusive lock.
 *
 * Constraints:
 * - No network and no registry identity beyond the sequence number.
 */

import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';

const STATE_FILENAME = 'state.json';
const LOCK_FILENAME = '.lock';
const LOCK_STALE_MS = 30_000;
const MAX_STATE_BYTES = 256 * 1024;
/** Bound the ledger so a hostile registry cannot grow the state file forever. */
const MAX_QUARANTINED_RELEASES = 500;

export interface StoredQuarantine {
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    /** Advisory sequence that recorded it; only a higher one may replace it. */
    readonly sequence: number;
    readonly reason: string;
    readonly recordedAt: number;
}

export interface AcceptedAdvisoryCheckpoint {
    readonly sequence: number;
    /** Digest covers the complete advisory and key-status snapshot. */
    readonly snapshotSha256: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
}

export interface RegistryState {
    readonly schemaVersion: 1;
    /** Highest advisory sequence accepted from the configured registry. */
    readonly acceptedAdvisorySequence: number;
    /** Latest authenticated checkpoint at the accepted sequence. */
    readonly acceptedAdvisoryCheckpoint: AcceptedAdvisoryCheckpoint | null;
    /** Release-scoped quarantine decisions, keyed by release id. */
    readonly quarantinedReleases: Readonly<Record<string, StoredQuarantine>>;
    readonly updatedAt: number;
}

export class RegistryStateCorruptError extends Error {
    constructor(message = 'The persisted registry trust state is corrupt or unreadable.') {
        super(message);
        this.name = 'RegistryStateCorruptError';
    }
}

export type RegistryStateAcceptanceErrorKind = 'replay' | 'equivocation';

/** A verified checkpoint lost the monotonic persistence race or conflicted. */
export class RegistryStateAcceptanceError extends Error {
    constructor(
        readonly kind: RegistryStateAcceptanceErrorKind,
        message: string
    ) {
        super(message);
        this.name = 'RegistryStateAcceptanceError';
    }
}

const EMPTY_STATE: RegistryState = {
    schemaVersion: 1,
    acceptedAdvisorySequence: 0,
    acceptedAdvisoryCheckpoint: null,
    quarantinedReleases: {},
    updatedAt: 0,
};

function parseQuarantines(value: unknown): Record<string, StoredQuarantine> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new RegistryStateCorruptError('The persisted quarantine ledger is invalid.');
    }
    const out: Record<string, StoredQuarantine> = {};
    let count = 0;
    for (const [releaseId, entry] of Object.entries(value as Record<string, unknown>)) {
        if (count >= MAX_QUARANTINED_RELEASES) {
            throw new RegistryStateCorruptError('The persisted quarantine ledger is too large.');
        }
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            throw new RegistryStateCorruptError('The persisted quarantine ledger contains an invalid entry.');
        }
        const record = entry as Record<string, unknown>;
        if (
            releaseId.length === 0 ||
            record.releaseId !== releaseId ||
            typeof record.pluginId !== 'string' ||
            record.pluginId.length === 0 ||
            typeof record.version !== 'string' ||
            record.version.length === 0 ||
            typeof record.sequence !== 'number' ||
            !Number.isSafeInteger(record.sequence) ||
            record.sequence < 0 ||
            typeof record.reason !== 'string' ||
            record.reason.length === 0 ||
            typeof record.recordedAt !== 'number' ||
            !Number.isFinite(record.recordedAt) ||
            record.recordedAt < 0
        ) {
            throw new RegistryStateCorruptError('The persisted quarantine ledger contains an invalid entry.');
        }
        out[releaseId] = {
            releaseId,
            pluginId: record.pluginId,
            version: record.version,
            sequence: record.sequence,
            reason: record.reason,
            recordedAt: record.recordedAt,
        };
        count += 1;
    }
    return out;
}

function parseState(value: unknown): RegistryState {
    if (typeof value !== 'object' || value === null) {
        throw new RegistryStateCorruptError('The persisted registry state is not an object.');
    }
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1) {
        throw new RegistryStateCorruptError('The persisted registry state has an unsupported schema.');
    }
    const sequence = record.acceptedAdvisorySequence;
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
        throw new RegistryStateCorruptError('The persisted advisory sequence is invalid.');
    }
    const checkpointValue = record.acceptedAdvisoryCheckpoint;
    let checkpoint: AcceptedAdvisoryCheckpoint | null = null;
    if (checkpointValue !== undefined && checkpointValue !== null) {
        if (typeof checkpointValue !== 'object' || Array.isArray(checkpointValue)) {
            throw new RegistryStateCorruptError('The persisted advisory checkpoint is invalid.');
        }
        const candidate = checkpointValue as Record<string, unknown>;
        if (
            typeof candidate.sequence !== 'number' ||
            !Number.isSafeInteger(candidate.sequence) ||
            candidate.sequence < 0 ||
            typeof candidate.snapshotSha256 !== 'string' ||
            !/^sha256-[a-f0-9]{64}$/.test(candidate.snapshotSha256) ||
            typeof candidate.issuedAt !== 'string' ||
            Number.isNaN(Date.parse(candidate.issuedAt)) ||
            typeof candidate.expiresAt !== 'string' ||
            Number.isNaN(Date.parse(candidate.expiresAt))
        ) {
            throw new RegistryStateCorruptError('The persisted advisory checkpoint is invalid.');
        }
        checkpoint = {
            sequence: candidate.sequence,
            snapshotSha256: candidate.snapshotSha256,
            issuedAt: candidate.issuedAt,
            expiresAt: candidate.expiresAt,
        };
        if (checkpoint.sequence !== sequence) {
            throw new RegistryStateCorruptError('The persisted checkpoint does not match its sequence.');
        }
    }
    return {
        schemaVersion: 1,
        acceptedAdvisorySequence: sequence,
        acceptedAdvisoryCheckpoint: checkpoint,
        quarantinedReleases: parseQuarantines(record.quarantinedReleases),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    };
}

export class RegistryStateStore {
    readonly #directory: string;

    constructor(root = EXTENSIONS_BASE_DIR) {
        this.#directory = resolve(root, '.registry');
    }

    statePath(): string {
        return resolve(this.#directory, STATE_FILENAME);
    }

    async read(): Promise<RegistryState> {
        try {
            const handle = await fs.open(this.statePath(), constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > MAX_STATE_BYTES) {
                    throw new RegistryStateCorruptError('The persisted registry state file is invalid.');
                }
                return parseState(JSON.parse(await handle.readFile('utf8')));
            } finally {
                await handle.close();
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STATE;
            if (error instanceof RegistryStateCorruptError) throw error;
            if (error instanceof SyntaxError) {
                throw new RegistryStateCorruptError('The persisted registry state is not valid JSON.');
            }
            // Permission, I/O and symlink errors must fail closed. Treating them
            // as an empty cursor could erase a quarantine after a restart.
            throw new RegistryStateCorruptError(
                `The persisted registry state could not be read: ${
                    error instanceof Error ? error.message : 'unknown storage error'
                }`
            );
        }
    }

    /**
     * Record a newly accepted sequence. A lower sequence is refused, so this can
     * only ever move forward.
     */
    async acceptAdvisorySequence(sequence: number, now: number = Date.now()): Promise<RegistryState> {
        if (!Number.isSafeInteger(sequence) || sequence < 0) {
            throw new TypeError('Advisory sequence must be a non-negative integer');
        }
        return await this.#accept(sequence, null, now);
    }

    /** Record a complete checkpoint, allowing a newer same-sequence checkpoint. */
    async acceptAdvisoryCheckpoint(
        checkpoint: AcceptedAdvisoryCheckpoint,
        now: number = Date.now()
    ): Promise<RegistryState> {
        if (
            !Number.isSafeInteger(checkpoint.sequence) ||
            checkpoint.sequence < 0 ||
            !/^sha256-[a-f0-9]{64}$/.test(checkpoint.snapshotSha256) ||
            Number.isNaN(Date.parse(checkpoint.issuedAt)) ||
            Number.isNaN(Date.parse(checkpoint.expiresAt))
        ) {
            throw new TypeError('Advisory checkpoint evidence is invalid');
        }
        return await this.#accept(checkpoint.sequence, checkpoint, now);
    }

    async #accept(
        sequence: number,
        checkpoint: AcceptedAdvisoryCheckpoint | null,
        now: number
    ): Promise<RegistryState> {
        await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
        const release = await this.#acquireLock(now);
        try {
            const current = await this.read();
            const currentCheckpoint = current.acceptedAdvisoryCheckpoint;
            if (sequence < current.acceptedAdvisorySequence) {
                throw new RegistryStateAcceptanceError(
                    'replay',
                    `Advisory sequence ${sequence} is older than accepted sequence ${current.acceptedAdvisorySequence}.`
                );
            }
            if (sequence === current.acceptedAdvisorySequence) {
                if (!checkpoint) {
                    if (currentCheckpoint) {
                        throw new RegistryStateAcceptanceError(
                            'replay',
                            'A sequence-only update cannot replace an authenticated checkpoint.'
                        );
                    }
                    return current;
                }
                if (!currentCheckpoint) {
                    // The first full checkpoint at a legacy sequence adds the
                    // evidence that the old sequence-only format did not have.
                } else {
                    const nextIssuedAt = Date.parse(checkpoint.issuedAt);
                    const currentIssuedAt = Date.parse(currentCheckpoint.issuedAt);
                    if (checkpoint.snapshotSha256 !== currentCheckpoint.snapshotSha256) {
                        throw new RegistryStateAcceptanceError(
                            'equivocation',
                            'Two different advisory snapshots share the same sequence.'
                        );
                    }
                    if (nextIssuedAt < currentIssuedAt) {
                        throw new RegistryStateAcceptanceError(
                            'replay',
                            'An older same-sequence advisory checkpoint was replayed.'
                        );
                    }
                    if (nextIssuedAt === currentIssuedAt) {
                        if (checkpoint.expiresAt !== currentCheckpoint.expiresAt) {
                            throw new RegistryStateAcceptanceError(
                                'equivocation',
                                'Two different advisory checkpoints share the same sequence and issue time.'
                            );
                        }
                        return current;
                    }
                }
            }

            const next: RegistryState = {
                schemaVersion: 1,
                acceptedAdvisorySequence: sequence,
                acceptedAdvisoryCheckpoint: checkpoint ??
                    (sequence === current.acceptedAdvisorySequence ? currentCheckpoint : null),
                quarantinedReleases: current.quarantinedReleases,
                updatedAt: now,
            };
            const temporary = resolve(this.#directory, `.${STATE_FILENAME}.${randomUUID()}.tmp`);
            const handle = await fs.open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(`${JSON.stringify(next)}\n`, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }
            await fs.rename(temporary, this.statePath());
            return next;
        } finally {
            await release();
        }
    }

    /**
     * Record verified quarantine decisions for individual releases.
     *
     * Quarantines are kept until a *higher* sequence replaces the entry for the
     * same release, so an unrelated resolve that advances the advisory cursor
     * cannot erase this release's decision.
     */
    async recordQuarantines(
        entries: readonly Omit<StoredQuarantine, 'recordedAt'>[],
        now: number = Date.now()
    ): Promise<RegistryState> {
        if (entries.length === 0) return await this.read();
        await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
        const release = await this.#acquireLock(now);
        try {
            const current = await this.read();
            const next: Record<string, StoredQuarantine> = { ...current.quarantinedReleases };
            let changed = false;
            for (const entry of entries) {
                const existing = next[entry.releaseId];
                if (existing && existing.sequence >= entry.sequence) continue;
                next[entry.releaseId] = { ...entry, recordedAt: now };
                changed = true;
            }
            // Bound the ledger deterministically: keep the highest sequences.
            const bounded = Object.fromEntries(
                Object.entries(next)
                    .sort((left, right) => right[1].sequence - left[1].sequence)
                    .slice(0, MAX_QUARANTINED_RELEASES)
            );
            if (
                Object.keys(bounded).length !== Object.keys(current.quarantinedReleases).length
            ) {
                changed = true;
            }
            if (!changed) return current;

            const state: RegistryState = {
                schemaVersion: 1,
                acceptedAdvisorySequence: current.acceptedAdvisorySequence,
                acceptedAdvisoryCheckpoint: current.acceptedAdvisoryCheckpoint,
                quarantinedReleases: bounded,
                updatedAt: now,
            };
            const temporary = resolve(this.#directory, `.${STATE_FILENAME}.${randomUUID()}.tmp`);
            const handle = await fs.open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }
            await fs.rename(temporary, this.statePath());
            return state;
        } finally {
            await release();
        }
    }

    /** Exclusive lock so two processes cannot both read one sequence and write two. */
    async #acquireLock(now: number): Promise<() => Promise<void>> {
        const path = resolve(this.#directory, LOCK_FILENAME);
        const deadline = now + 5_000;
        for (;;) {
            try {
                const handle = await fs.open(path, 'wx', 0o600);
                await handle.close();
                return async () => {
                    await fs.rm(path, { force: true }).catch(() => undefined);
                };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                try {
                    const stat = await fs.stat(path);
                    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                        await fs.rm(path, { force: true }).catch(() => undefined);
                        continue;
                    }
                } catch {
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new Error('The registry state lock is held; retry shortly.');
                }
                await new Promise((resolveWait) => setTimeout(resolveWait, 10 + Math.floor(Math.random() * 20)));
            }
        }
    }
}
