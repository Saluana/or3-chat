/**
 * @module server/utils/plugins/acquisition/registry-state
 *
 * Purpose:
 * The small amount of durable state the acquisition track keeps about a registry:
 * the highest advisory sequence this host has accepted.
 *
 * Behavior:
 * - Monotonic: a lower sequence is refused, so a replayed catalog can never clear
 *   a revocation the host already saw.
 * - Atomic writes under `<extensions>/.operations/`, the same directory and the
 *   same write discipline as the operation store.
 *
 * Constraints:
 * - No network and no registry identity beyond the sequence number.
 */

import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';

const STATE_FILENAME = 'registry-state.json';
const MAX_STATE_BYTES = 8 * 1024;

export interface RegistryState {
    readonly schemaVersion: 1;
    /** Highest advisory sequence accepted from the configured registry. */
    readonly acceptedAdvisorySequence: number;
    readonly updatedAt: number;
}

const EMPTY_STATE: RegistryState = {
    schemaVersion: 1,
    acceptedAdvisorySequence: 0,
    updatedAt: 0,
};

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
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    };
}

export class RegistryStateStore {
    readonly #directory: string;

    constructor(root = EXTENSIONS_BASE_DIR) {
        this.#directory = resolve(root, '.operations');
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
        const current = await this.read();
        if (sequence <= current.acceptedAdvisorySequence) return current;

        const next: RegistryState = {
            schemaVersion: 1,
            acceptedAdvisorySequence: sequence,
            updatedAt: now,
        };
        await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
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
    }
}
