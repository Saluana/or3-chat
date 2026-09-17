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

export interface RegistryState {
    readonly schemaVersion: 1;
    /** Highest advisory sequence accepted from the configured registry. */
    readonly acceptedAdvisorySequence: number;
    /** Release-scoped quarantine decisions, keyed by release id. */
    readonly quarantinedReleases: Readonly<Record<string, StoredQuarantine>>;
    readonly updatedAt: number;
}

const EMPTY_STATE: RegistryState = {
    schemaVersion: 1,
    acceptedAdvisorySequence: 0,
    quarantinedReleases: {},
    updatedAt: 0,
};

function parseQuarantines(value: unknown): Record<string, StoredQuarantine> {
    if (typeof value !== 'object' || value === null) return {};
    const out: Record<string, StoredQuarantine> = {};
    let count = 0;
    for (const [releaseId, entry] of Object.entries(value as Record<string, unknown>)) {
        if (count >= MAX_QUARANTINED_RELEASES) break;
        if (typeof entry !== 'object' || entry === null) continue;
        const record = entry as Record<string, unknown>;
        if (
            typeof record.pluginId !== 'string' ||
            typeof record.version !== 'string' ||
            typeof record.sequence !== 'number' ||
            !Number.isSafeInteger(record.sequence) ||
            record.sequence < 0 ||
            typeof record.reason !== 'string'
        ) {
            continue;
        }
        out[releaseId] = {
            releaseId,
            pluginId: record.pluginId,
            version: record.version,
            sequence: record.sequence,
            reason: record.reason,
            recordedAt: typeof record.recordedAt === 'number' ? record.recordedAt : 0,
        };
        count += 1;
    }
    return out;
}

function parseState(value: unknown): RegistryState {
    if (typeof value !== 'object' || value === null) return EMPTY_STATE;
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1) return EMPTY_STATE;
    const sequence = record.acceptedAdvisorySequence;
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
        return EMPTY_STATE;
    }
    return {
        schemaVersion: 1,
        acceptedAdvisorySequence: sequence,
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
                if (!stat.isFile() || stat.size > MAX_STATE_BYTES) return EMPTY_STATE;
                return parseState(JSON.parse(await handle.readFile('utf8')));
            } finally {
                await handle.close();
            }
        } catch {
            // An unreadable state file is treated as "nothing accepted yet"; the
            // monotonic check still protects a host that has accepted a sequence.
            return EMPTY_STATE;
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
        await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
        const release = await this.#acquireLock(now);
        try {
            const current = await this.read();
            if (sequence <= current.acceptedAdvisorySequence) return current;

            const next: RegistryState = {
                schemaVersion: 1,
                acceptedAdvisorySequence: sequence,
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
