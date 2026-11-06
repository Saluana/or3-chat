import type { H3Event } from 'h3';
import { getWorkspaceAccessStore } from '../admin/stores/registry';
import type { WorkspaceAccessStore } from '../admin/stores/types';

type Observation = Parameters<NonNullable<WorkspaceAccessStore['recordSyncObservation']>>[0];

/**
 * Repeats of the last persisted outcome for one user/workspace are coalesced for
 * this long. A changed outcome or failure code is written immediately, so the
 * stored state is exact and only repeat timestamps can lag, by at most this window.
 */
export const SYNC_OBSERVATION_WINDOW_MS = 60_000;
const MAX_TRACKED = 10_000;

interface Tracked {
    record: (observation: Observation) => Promise<void>;
    /** Outcome and code most recently handed to the store. */
    state: string;
    writtenAt: number;
    /** Latest coalesced repeat of `state`, written when the window ends. */
    pending: Observation | null;
    timer: ReturnType<typeof setTimeout> | null;
}
// Insertion order is recency order: each observation re-inserts its key.
const tracked = new Map<string, Tracked>();
let warnedAt = 0;

const signature = (observation: Observation) => `${observation.outcome}:${observation.code ?? ''}`;

function persist(entry: Tracked, observation: Observation) {
    entry.state = signature(observation);
    entry.writtenAt = Date.now();
    // Never on the request path; the provider upsert keeps the newest timestamps in any arrival order.
    void Promise.resolve().then(() => entry.record(observation)).catch(() => {
        if (Date.now() - warnedAt < 60_000) return;
        warnedAt = Date.now();
        console.warn('[sync] Diagnostic persistence unavailable; request outcomes are unaffected.');
    });
}

function takePending(entry: Tracked): Observation | null {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    const pending = entry.pending;
    entry.pending = null;
    return pending;
}

function observe(store: WorkspaceAccessStore, observation: Observation) {
    if (!store.recordSyncObservation) return;
    const key = `${observation.userId}\0${observation.workspaceId}`;
    let entry = tracked.get(key);
    if (entry) tracked.delete(key);
    else {
        if (tracked.size >= MAX_TRACKED) {
            const [oldestKey, oldest] = tracked.entries().next().value!;
            tracked.delete(oldestKey);
            const pending = takePending(oldest);
            if (pending) persist(oldest, pending);
        }
        entry = { record: async () => {}, state: '', writtenAt: 0, pending: null, timer: null };
    }
    entry.record = store.recordSyncObservation.bind(store);
    tracked.set(key, entry);
    const changed = signature(observation) !== entry.state;
    if (changed || Date.now() - entry.writtenAt >= SYNC_OBSERVATION_WINDOW_MS) {
        // A coalesced repeat of the previous state lands first so its time is not stale.
        const previous = takePending(entry);
        if (previous && changed) persist(entry, previous);
        persist(entry, observation);
        return;
    }
    entry.pending = observation;
    if (!entry.timer) {
        const current = entry;
        current.timer = setTimeout(() => {
            current.timer = null;
            const pending = takePending(current);
            if (pending) persist(current, pending);
        }, Math.max(0, current.writtenAt + SYNC_OBSERVATION_WINDOW_MS - Date.now()));
        current.timer.unref?.();
    }
}

/** Runs only after authentication and workspace authorization. Payloads and raw
 * provider errors never enter diagnostics. Diagnostics are recorded off the
 * request path and can never change a request's result, especially after a committed push. */
export async function observeSyncRequest<T>(event: H3Event, userId: string, workspaceId: string,
    operation: Observation['operation'], work: () => Promise<T>): Promise<T> {
    const record = (outcome: Observation['outcome'], code?: string) => {
        try { observe(getWorkspaceAccessStore(event), { userId, workspaceId, operation, observedAt: Date.now(), outcome, code }); }
        catch { /* No store for this provider: no observation coverage. */ }
    };
    try {
        const result = await work();
        const pushResult = result as unknown as { results?: Array<{ success?: boolean }> } | null;
        const mixedFailure = operation === 'push' && Array.isArray(pushResult?.results)
            && pushResult.results.some(item => item.success !== true);
        record(mixedFailure ? 'failure' : 'success', mixedFailure ? 'operation_rejected' : undefined);
        return result;
    } catch (error) {
        const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
        record('failure', status === 429 ? 'rate_limited' : status === 403 ? 'access_denied' : status < 500 ? 'request_rejected' : 'provider_failed');
        throw error;
    }
}
