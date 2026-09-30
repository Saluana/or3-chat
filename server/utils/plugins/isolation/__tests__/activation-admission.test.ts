import { beforeEach, describe, expect, it } from 'vitest';
import {
    ACTIVATION_REPLAY_TTL_MS,
    MAX_ACTIVATION_IN_FLIGHT,
    MAX_ACTIVATION_SEEN_IDS,
    MAX_ACTIVATION_SIDE_EFFECT_IDS,
    abortActivationCalls,
    clearAllActivationAdmissionsForTests,
    fingerprintCapabilityCall,
    getActivationAdmissionStats,
    isSideEffectingCapabilityMethod,
    tryAdmitActivationCall,
} from '../activation-admission';

/**
 * Activation-scoped admission (workstream 3).
 *
 * The HTTP capability route serves one RPC per request, but replay and
 * concurrency must span requests. These tests pin the cross-request behavior:
 * a duplicate request ID is rejected whether it arrives concurrently or after
 * completion, on the same connection or a new one, while the same ID under a
 * different activation is a different call.
 */
describe('activation admission', () => {
    beforeEach(() => {
        clearAllActivationAdmissionsForTests();
    });

    it('rejects a concurrent duplicate request ID on the same activation', () => {
        const first = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        expect(first.ok).toBe(true);

        // A second HTTP request reusing the same activation and request ID.
        const second = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        expect(second).toMatchObject({ ok: false, code: 'replay' });

        if (first.ok) first.release();
    });

    it('rejects a duplicate request ID after completion', () => {
        const first = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.models',
            params: {},
        });
        expect(first.ok).toBe(true);
        if (first.ok) first.release('completed');

        const replay = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.models',
            params: {},
        });
        expect(replay).toMatchObject({ ok: false, code: 'replay' });
    });

    it('allows the same request ID under different activations', () => {
        const first = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-shared',
            method: 'ai.models',
            params: {},
        });
        expect(first.ok).toBe(true);

        // A different activation (plugin/user/workspace) owns its own ID space.
        const second = tryAdmitActivationCall('act-2', {
            requestId: 'rpc-shared',
            method: 'ai.models',
            params: {},
        });
        expect(second.ok).toBe(true);

        if (first.ok) first.release();
        if (second.ok) second.release();
    });

    it('rejects a reused ID with a different method or params as a replay', () => {
        const first = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.models',
            params: {},
        });
        expect(first.ok).toBe(true);
        if (first.ok) first.release('completed');

        // The ID must never silently become a different side effect.
        const mismatched = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        expect(mismatched).toMatchObject({
            ok: false,
            code: 'replay',
            details: { fingerprintMismatch: true },
        });
        expect(
            fingerprintCapabilityCall('ai.models', {}) ===
                fingerprintCapabilityCall('ai.complete', { model: 'm', prompt: 'p' })
        ).toBe(false);
    });

    it('enforces the concurrency ceiling across simultaneous requests', () => {
        const releases: Array<() => void> = [];
        for (let index = 0; index < MAX_ACTIVATION_IN_FLIGHT; index += 1) {
            const admitted = tryAdmitActivationCall('act-1', {
                requestId: `rpc-${index}`,
                method: 'ai.complete',
                params: { model: 'm', prompt: 'p' },
            });
            expect(admitted.ok).toBe(true);
            if (admitted.ok) releases.push(() => admitted.release());
        }

        const overflow = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-overflow',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        expect(overflow).toMatchObject({ ok: false, code: 'backpressure' });

        // Releasing one slot admits exactly one more call.
        releases[0]?.();
        const admitted = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-overflow',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        expect(admitted.ok).toBe(true);
        if (admitted.ok) admitted.release();
        for (const release of releases.slice(1)) release();
    });

    it('frees the slot on cancellation, timeout and provider error outcomes', () => {
        for (const outcome of ['cancelled', 'deadline-exceeded', 'failed']) {
            const admitted = tryAdmitActivationCall('act-1', {
                requestId: `rpc-${outcome}`,
                method: 'connections.dispatch',
                params: { ref: 'r', operationId: 'o', url: 'https://x.test/' },
            });
            expect(admitted.ok).toBe(true);
            if (admitted.ok) admitted.release(outcome);
        }
        expect(getActivationAdmissionStats('act-1')).toMatchObject({
            inFlight: 0,
            seen: 0,
            sideEffected: 3,
        });
    });

    it('aborts an in-flight call on client disconnect without leaking the slot', () => {
        const admitted = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-disconnect',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) return;
        let aborted = false;
        admitted.controller.signal.addEventListener('abort', () => {
            aborted = true;
        });

        // The route aborts the admitted controller on client disconnect.
        admitted.controller.abort('client-disconnected');
        expect(aborted).toBe(true);

        // The route releases the slot when the broker settles as cancelled.
        admitted.release('cancelled');
        expect(getActivationAdmissionStats('act-1')).toMatchObject({ inFlight: 0 });
    });

    it('aborts every in-flight call when the activation is torn down', () => {
        const first = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-1',
            method: 'ai.complete',
            params: {},
        });
        const second = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-2',
            method: 'ai.complete',
            params: {},
        });
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        let aborted = 0;
        if (first.ok) first.controller.signal.addEventListener('abort', () => (aborted += 1));
        if (second.ok) second.controller.signal.addEventListener('abort', () => (aborted += 1));

        abortActivationCalls('act-1', 'activation-revoked');
        expect(aborted).toBe(2);
        expect(getActivationAdmissionStats('act-1')).toMatchObject({
            inFlight: 0,
            seen: 0,
        });

        // A late release after teardown is a no-op, not a resurrection.
        if (first.ok) first.release('cancelled');
        expect(getActivationAdmissionStats('act-1')).toMatchObject({
            inFlight: 0,
            seen: 0,
        });
    });

    it('bounds replay history by count and TTL', () => {
        let now = 1_700_000_000_000;
        const clock = () => now;
        for (let index = 0; index < MAX_ACTIVATION_SEEN_IDS + 10; index += 1) {
            const admitted = tryAdmitActivationCall('act-1', {
                requestId: `rpc-${index}`,
                method: 'ai.models',
                params: {},
                now: clock,
            });
            expect(admitted.ok).toBe(true);
            if (admitted.ok) admitted.release('completed');
        }
        expect(getActivationAdmissionStats('act-1').seen).toBeLessThanOrEqual(
            MAX_ACTIVATION_SEEN_IDS
        );

        // After the TTL the oldest IDs no longer reject a reuse.
        now += ACTIVATION_REPLAY_TTL_MS + 1;
        const reused = tryAdmitActivationCall('act-1', {
            requestId: `rpc-${MAX_ACTIVATION_SEEN_IDS + 9}`,
            method: 'ai.models',
            params: {},
            now: clock,
        });
        expect(reused.ok).toBe(true);
        if (reused.ok) reused.release();
    });

    it('classifies provider calls and external writes as side-effecting', () => {
        expect(isSideEffectingCapabilityMethod('ai.complete')).toBe(true);
        expect(isSideEffectingCapabilityMethod('connections.dispatch')).toBe(true);
        expect(isSideEffectingCapabilityMethod('ai.models')).toBe(false);
        // Unknown methods never execute, so they must not consume the
        // fail-closed side-effect history.
        expect(isSideEffectingCapabilityMethod('evil.method')).toBe(false);
    });

    it('retains side-effect fingerprints across read-history churn', () => {
        const first = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-write',
            method: 'connections.dispatch',
            params: { ref: 'r', operationId: 'o', url: 'https://x.test/' },
        });
        expect(first.ok).toBe(true);
        if (first.ok) first.release('completed');

        // Churn past the read window with reads and other side effects.
        for (let index = 0; index < MAX_ACTIVATION_SEEN_IDS + 10; index += 1) {
            const admitted = tryAdmitActivationCall('act-1', {
                requestId: `rpc-churn-${index}`,
                method: index % 2 === 0 ? 'ai.models' : 'ai.complete',
                params: {},
            });
            expect(admitted.ok).toBe(true);
            if (admitted.ok) admitted.release('completed');
        }

        // The side effect still rejects a same-ID replay.
        expect(
            tryAdmitActivationCall('act-1', {
                requestId: 'rpc-write',
                method: 'connections.dispatch',
                params: { ref: 'r', operationId: 'o', url: 'https://x.test/' },
            })
        ).toMatchObject({ ok: false, code: 'replay' });
    });

    it('retains side-effect fingerprints past the read TTL', () => {
        let now = 1_700_000_000_000;
        const clock = () => now;
        const read = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-read',
            method: 'ai.models',
            params: {},
            now: clock,
        });
        expect(read.ok).toBe(true);
        if (read.ok) read.release('completed');
        const write = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-write',
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            now: clock,
        });
        expect(write.ok).toBe(true);
        if (write.ok) write.release('completed');

        // Past the read TTL the read ID is reusable but the side effect is not.
        now += ACTIVATION_REPLAY_TTL_MS + 1;
        const readReuse = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-read',
            method: 'ai.models',
            params: {},
            now: clock,
        });
        expect(readReuse.ok).toBe(true);
        if (readReuse.ok) readReuse.release('completed');
        expect(
            tryAdmitActivationCall('act-1', {
                requestId: 'rpc-write',
                method: 'ai.complete',
                params: { model: 'm', prompt: 'p' },
                now: clock,
            })
        ).toMatchObject({ ok: false, code: 'replay' });
    });

    it('refuses further side effects when the side-effect history fills', () => {
        for (let index = 0; index < MAX_ACTIVATION_SIDE_EFFECT_IDS; index += 1) {
            const admitted = tryAdmitActivationCall('act-1', {
                requestId: `rpc-write-${index}`,
                method: 'ai.complete',
                params: {},
            });
            expect(admitted.ok).toBe(true);
            if (admitted.ok) admitted.release('completed');
        }

        // No eviction: the first record still rejects its replay.
        expect(
            tryAdmitActivationCall('act-1', {
                requestId: 'rpc-write-0',
                method: 'ai.complete',
                params: {},
            })
        ).toMatchObject({ ok: false, code: 'replay' });

        // Further side effects fail closed while reads still flow.
        expect(
            tryAdmitActivationCall('act-1', {
                requestId: 'rpc-write-overflow',
                method: 'ai.complete',
                params: {},
            })
        ).toMatchObject({ ok: false, code: 'backpressure' });
        const read = tryAdmitActivationCall('act-1', {
            requestId: 'rpc-read-overflow',
            method: 'ai.models',
            params: {},
        });
        expect(read.ok).toBe(true);
        if (read.ok) read.release('completed');
    });
});
