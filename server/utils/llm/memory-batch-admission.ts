/**
 * Process-local admission for automatic-memory batches.
 *
 * Tabs and Cloud sessions that finish the same chat turn submit identical
 * capture state. The first request starts one inference; concurrent requests
 * join it, and a finished answer stays replayable so a client whose response
 * or save was interrupted recovers it without paying again. A failed batch is
 * held back for a short cooldown instead of being redispatched by every
 * caller. The flight is detached from the request that started it: a closed
 * tab must not discard an answer another session can still use, and the
 * inference deadlines already bound its cost. Multi-instance deployments only
 * coalesce requests that reach the same instance; the synced batch cursor
 * still prevents double saves.
 */
export const MEMORY_BATCH_REPLAY_MS = 10 * 60_000;
export const MEMORY_BATCH_COOLDOWN_MS = 60_000;
const MAX_BATCHES = 256;

interface Flight<T> {
    outcome: Promise<T>;
    /** Absent while the inference is running. */
    expiresAt?: number;
    failed?: boolean;
}
const flights = new Map<string, Flight<unknown>>();

/** Thrown for a batch that failed recently; carries the remaining cooldown. */
export class MemoryBatchCooldownError extends Error {
    constructor(readonly retryAfterMs: number) {
        super('Automatic memory inference is cooling down.');
    }
}

/** The admitted flight for this batch, if one is running or replayable. */
export function joinMemoryBatch<T>(key: string, now = Date.now()): Promise<T> | undefined {
    const flight = flights.get(key);
    if (!flight) return undefined;
    if (flight.expiresAt === undefined) return flight.outcome as Promise<T>;
    if (flight.expiresAt <= now) {
        flights.delete(key);
        return undefined;
    }
    return flight.failed
        ? Promise.reject(new MemoryBatchCooldownError(flight.expiresAt - now))
        : (flight.outcome as Promise<T>);
}

/** Joins an existing flight or starts `dispatch` as the only inference for this batch. */
export function admitMemoryBatch<T>(key: string, dispatch: () => Promise<T>): Promise<T> {
    const joined = joinMemoryBatch<T>(key);
    if (joined) return joined;
    while (flights.size >= MAX_BATCHES) flights.delete(flights.keys().next().value!);
    const flight: Flight<T> = { outcome: undefined as unknown as Promise<T> };
    flight.outcome = dispatch().then(
        (result) => {
            flight.expiresAt = Date.now() + MEMORY_BATCH_REPLAY_MS;
            return result;
        },
        (error) => {
            flight.failed = true;
            flight.expiresAt = Date.now() + MEMORY_BATCH_COOLDOWN_MS;
            throw error;
        },
    );
    flights.set(key, flight);
    return flight.outcome;
}
