/**
 * @module server/utils/plugins/isolation/activation-admission
 *
 * Purpose:
 * Activation-scoped admission state for the portable capability bridge.
 * The HTTP capability route serves one RPC per request, but replay and
 * concurrency enforcement must span requests: two HTTP calls that share an
 * activation and request ID must not both run, and concurrent calls must share
 * one limit instead of each seeing an empty broker.
 *
 * Behavior:
 * - State is keyed by the server-minted activation handle, which already binds
 *   plugin, workspace, user, generation, package digest and grants. The same
 *   request ID under a different activation is a different call.
 * - A request ID that is currently in flight is rejected as `replay`
 *   (concurrent duplicate). A request ID seen within the bounded replay window
 *   is rejected as `replay` even when the method or params differ, so a reused
 *   ID can never silently become a different side effect.
 * - Concurrency is bounded per activation by the recorded containment budget
 *   (`maxConcurrentCalls`). The per-request broker keeps its own grant,
 *   deadline and abort checks; this store is the cross-request authority.
 * - Pure reads keep a bounded, expiring replay window (count + TTL): a repeat
 *   after eviction only recomputes a read. Side-effecting calls
 *   (`ai.complete`, `connections.dispatch`) keep their fingerprints for the
 *   life of the activation; when that bounded history fills, further
 *   side-effecting calls are refused instead of evicting still-relevant
 *   entries. Activation teardown forgets both histories together.
 * - Each admitted call owns an `AbortController`. Client disconnect aborts the
 *   in-flight handler, and activation teardown aborts every remaining call.
 *
 * Non-Goals:
 * - Cross-process coordination. The launch topology is a single Node process
 *   per host (see the containment documentation). A restart forgets handles
 *   and admission state together, so stale calls fail closed with
 *   `activation-unknown` and must remint.
 * - Provider idempotency. AI spend is reserved in the durable ledger with
 *   worst-case settlement; connection dispatch has no provider idempotency
 *   guarantee, so a lost response is an unknown outcome and must not be
 *   auto-retried with a new ID.
 */

import { createHash } from 'node:crypto';
import { DEFAULT_CONTAINMENT_BUDGETS } from '~~/shared/plugins/isolation/budgets';

/** Cross-request concurrency ceiling per activation (recorded budget). */
export const MAX_ACTIVATION_IN_FLIGHT = DEFAULT_CONTAINMENT_BUDGETS.maxConcurrentCalls;
/** Bounded replay history per activation for pure reads; entries expire. */
export const MAX_ACTIVATION_SEEN_IDS = 256;
/** How long a completed read request ID still rejects a duplicate. */
export const ACTIVATION_REPLAY_TTL_MS = 5 * 60 * 1000;
/**
 * Bounded side-effect history per activation. Aligned with the recorded
 * per-activation call budget; entries never expire early, and admission fails
 * closed once the history fills instead of evicting still-relevant entries.
 */
export const MAX_ACTIVATION_SIDE_EFFECT_IDS =
    DEFAULT_CONTAINMENT_BUDGETS.maxCallsPerActivation;
/** Upper bound on tracked activations; oldest entries are dropped first. */
const MAX_ADMISSION_ACTIVATIONS = 1024;

/**
 * Side-effecting capability methods. These are wire-stable method names (the
 * canonical constants are `PLUGIN_AI_COMPLETE_METHOD` and
 * `CONNECTIONS_DISPATCH_METHOD`); renaming them would break sandboxes, so the
 * literals here cannot drift silently. Unknown methods fail open into the
 * read window: they never execute (the broker rejects them), so they must not
 * consume the fail-closed side-effect history.
 */
export function isSideEffectingCapabilityMethod(method: string): boolean {
    return method === 'ai.complete' || method === 'connections.dispatch';
}

interface InFlightCall {
    readonly controller: AbortController;
    readonly method: string;
    readonly fingerprint: string;
    readonly sideEffecting: boolean;
    readonly startedAt: number;
}

interface SeenCall {
    readonly method: string;
    readonly fingerprint: string;
    readonly completedAt: number;
    readonly outcome: string;
}

interface AdmissionState {
    readonly inFlight: Map<string, InFlightCall>;
    /** Pure reads: bounded count + TTL; eviction only recomputes a read. */
    readonly seen: Map<string, SeenCall>;
    /** Side effects: retained for the life of the activation, never evicted. */
    readonly sideEffected: Map<string, SeenCall>;
    lastTouched: number;
}

const admissions = new Map<string, AdmissionState>();

function stateFor(activationId: string, now: number): AdmissionState {
    let state = admissions.get(activationId);
    if (!state) {
        state = {
            inFlight: new Map(),
            seen: new Map(),
            sideEffected: new Map(),
            lastTouched: now,
        };
        admissions.set(activationId, state);
        while (admissions.size > MAX_ADMISSION_ACTIVATIONS) {
            const oldest = admissions.keys().next().value;
            if (typeof oldest !== 'string') break;
            if (oldest === activationId) break;
            abortActivationCalls(oldest, 'admission-evicted');
        }
    }
    state.lastTouched = now;
    return state;
}

function pruneSeen(state: AdmissionState, now: number): void {
    const cutoff = now - ACTIVATION_REPLAY_TTL_MS;
    for (const [id, entry] of state.seen) {
        if (entry.completedAt < cutoff) {
            state.seen.delete(id);
            continue;
        }
        // Entries are inserted in completion order; stop at the first live one.
        break;
    }
    while (state.seen.size > MAX_ACTIVATION_SEEN_IDS) {
        const oldest = state.seen.keys().next().value;
        if (typeof oldest !== 'string') break;
        state.seen.delete(oldest);
    }
}

function stableStringify(value: unknown, depth = 0): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'string':
            return JSON.stringify(value);
        case 'number':
        case 'boolean':
            return Number.isFinite(value as number) || typeof value === 'boolean'
                ? String(value)
                : 'null';
        case 'undefined':
            return 'null';
        case 'object': {
            if (depth > 32) return '"…"';
            if (Array.isArray(value)) {
                return `[${value.map((entry) => stableStringify(entry, depth + 1)).join(',')}]`;
            }
            const entries = Object.entries(value as Record<string, unknown>)
                .filter(([, entry]) => typeof entry !== 'function' && typeof entry !== 'symbol')
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
            return `{${entries
                .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry, depth + 1)}`)
                .join(',')}}`;
        }
        default:
            return 'null';
    }
}

/**
 * Stable fingerprint of a capability call. Used to detect a reused request ID
 * that changed method or params; the call is still rejected as `replay`, but
 * the mismatch is reported instead of silently running a new side effect.
 */
export function fingerprintCapabilityCall(
    method: string,
    params: Readonly<Record<string, unknown>>
): string {
    return createHash('sha256')
        .update(`${method}\u0000${stableStringify(params)}`, 'utf8')
        .digest('hex');
}

export type ActivationAdmission =
    | {
          readonly ok: true;
          readonly controller: AbortController;
          readonly release: (outcome?: string) => void;
      }
    | {
          readonly ok: false;
          readonly code: 'replay' | 'backpressure';
          readonly message: string;
          readonly details?: Readonly<Record<string, unknown>>;
      };

/**
 * Admit one capability call at activation scope. Call `release` exactly once
 * when the call settles (success, failure, timeout, cancellation or disconnect)
 * so the slot frees and the ID enters the bounded replay window.
 */
export function tryAdmitActivationCall(
    activationId: string,
    input: {
        readonly requestId: string;
        readonly method: string;
        readonly params: Readonly<Record<string, unknown>>;
        readonly now?: () => number;
        readonly maxInFlight?: number;
    }
): ActivationAdmission {
    const now = (input.now ?? Date.now)();
    const state = stateFor(activationId, now);
    pruneSeen(state, now);
    const fingerprint = fingerprintCapabilityCall(input.method, input.params);
    const sideEffecting = isSideEffectingCapabilityMethod(input.method);

    const inflight = state.inFlight.get(input.requestId);
    if (inflight) {
        return {
            ok: false,
            code: 'replay',
            message: `Duplicate RPC request id: ${input.requestId}`,
            details: {
                duplicate: 'in-flight',
                originalMethod: inflight.method,
                fingerprintMismatch: inflight.fingerprint !== fingerprint,
            },
        };
    }

    const seen = state.seen.get(input.requestId);
    if (seen) {
        return {
            ok: false,
            code: 'replay',
            message: `Duplicate RPC request id: ${input.requestId}`,
            details: {
                duplicate: 'completed',
                originalMethod: seen.method,
                fingerprintMismatch: seen.fingerprint !== fingerprint,
            },
        };
    }

    const sideEffected = state.sideEffected.get(input.requestId);
    if (sideEffected) {
        return {
            ok: false,
            code: 'replay',
            message: `Duplicate RPC request id: ${input.requestId}`,
            details: {
                duplicate: 'side-effect',
                originalMethod: sideEffected.method,
                fingerprintMismatch: sideEffected.fingerprint !== fingerprint,
            },
        };
    }

    if (sideEffecting && sideEffectCount(state) >= MAX_ACTIVATION_SIDE_EFFECT_IDS) {
        // Fail closed: evicting a side-effect record would reopen its replay,
        // so a full history refuses further side effects until a new activation.
        return {
            ok: false,
            code: 'backpressure',
            message: `Side-effect history is full (${MAX_ACTIVATION_SIDE_EFFECT_IDS}); start the plugin again`,
        };
    }

    const ceiling = input.maxInFlight ?? MAX_ACTIVATION_IN_FLIGHT;
    if (state.inFlight.size >= ceiling) {
        return {
            ok: false,
            code: 'backpressure',
            message: `RPC in-flight limit of ${ceiling} exceeded`,
        };
    }

    const controller = new AbortController();
    state.inFlight.set(input.requestId, {
        controller,
        method: input.method,
        fingerprint,
        sideEffecting,
        startedAt: now,
    });
    let released = false;
    const release = (outcome = 'completed'): void => {
        if (released) return;
        released = true;
        const current = admissions.get(activationId);
        // Revocation clears the whole entry; a late release is a no-op.
        if (!current) return;
        current.inFlight.delete(input.requestId);
        const record: SeenCall = {
            method: input.method,
            fingerprint,
            completedAt: (input.now ?? Date.now)(),
            outcome,
        };
        if (sideEffecting) {
            // Retained for the life of the activation; never evicted early.
            current.sideEffected.set(input.requestId, record);
            return;
        }
        pruneSeen(current, (input.now ?? Date.now)());
        current.seen.delete(input.requestId);
        current.seen.set(input.requestId, record);
        pruneSeen(current, (input.now ?? Date.now)());
    };
    return { ok: true, controller, release };
}

/** Completed plus in-flight side effects; the retained total never exceeds its bound. */
function sideEffectCount(state: AdmissionState): number {
    let count = state.sideEffected.size;
    for (const call of state.inFlight.values()) {
        if (call.sideEffecting) count += 1;
    }
    return count;
}

/**
 * Abort every in-flight call for an activation and forget its replay history.
 * Used by activation teardown (revoke, expiry, eviction, disable, update,
 * workspace switch, logout) so a stale handle leaves no runnable work behind.
 */
export function abortActivationCalls(activationId: string, reason = 'activation-revoked'): void {
    const state = admissions.get(activationId);
    if (!state) return;
    for (const call of state.inFlight.values()) {
        try {
            call.controller.abort(reason);
        } catch {
            // Aborting must never throw teardown off its path.
        }
    }
    admissions.delete(activationId);
}

export function getActivationAdmissionStats(activationId: string): {
    readonly inFlight: number;
    readonly seen: number;
    readonly sideEffected: number;
} {
    const state = admissions.get(activationId);
    if (!state) return { inFlight: 0, seen: 0, sideEffected: 0 };
    return {
        inFlight: state.inFlight.size,
        seen: state.seen.size,
        sideEffected: state.sideEffected.size,
    };
}

/** Test helper: forget every admission entry between cases. */
export function clearAllActivationAdmissionsForTests(): void {
    for (const state of admissions.values()) {
        for (const call of state.inFlight.values()) {
            try {
                call.controller.abort('tests-cleared');
            } catch {
                // Ignore abort errors during test reset.
            }
        }
    }
    admissions.clear();
}
