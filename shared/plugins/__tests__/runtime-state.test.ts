import { describe, expect, it } from 'vitest';
import {
    PLUGIN_RUNTIME_STATUSES,
    PLUGIN_RUNTIME_TRANSITIONS,
    canTransitionRuntimeStatus,
    classifyRuntimeFailure,
    transitionRuntimeStatus,
    type PluginRuntimeStatus,
} from '../runtime-state';

const legalEdges = new Set([
    'discovered->verified',
    'discovered->blocked',
    'verified->preparing',
    'verified->blocked',
    'blocked->discovered',
    'preparing->activating',
    'preparing->failed',
    'preparing->quarantined',
    'preparing->stopping',
    'activating->active',
    'activating->failed',
    'activating->quarantined',
    'activating->stopping',
    'active->stopping',
    'stopping->discovered',
    'stopping->failed',
    'failed->discovered',
    'failed->quarantined',
    'failed->stopping',
    'quarantined->discovered',
]);

const transitionCases = PLUGIN_RUNTIME_STATUSES.flatMap((from) =>
    PLUGIN_RUNTIME_STATUSES.map((to) => ({
        from,
        to,
        legal: legalEdges.has(`${from}->${to}`),
    }))
);

describe('plugin runtime state machine', () => {
    it('publishes the reviewed transition table', () => {
        const published = new Set(
            Object.entries(PLUGIN_RUNTIME_TRANSITIONS).flatMap(([from, targets]) =>
                targets.map((to) => `${from}->${to}`)
            )
        );
        expect(published).toEqual(legalEdges);
    });

    it.each(transitionCases)(
        'classifies $from -> $to as legal=$legal',
        ({ from, to, legal }: { from: PluginRuntimeStatus; to: PluginRuntimeStatus; legal: boolean }) => {
            expect(canTransitionRuntimeStatus(from, to)).toBe(legal);
            const result = transitionRuntimeStatus(from, to);
            if (legal) {
                expect(result).toEqual({ ok: true, status: to });
            } else {
                expect(result).toEqual({
                    ok: false,
                    error: { code: 'invalid-runtime-transition', from, to },
                });
            }
        }
    );

    it('quarantines exactly when the in-session failure threshold is reached', () => {
        expect(classifyRuntimeFailure(0, 3)).toEqual({
            ok: true,
            failureCount: 1,
            status: 'failed',
        });
        expect(classifyRuntimeFailure(1, 3)).toEqual({
            ok: true,
            failureCount: 2,
            status: 'failed',
        });
        expect(classifyRuntimeFailure(2, 3)).toEqual({
            ok: true,
            failureCount: 3,
            status: 'quarantined',
        });
        expect(classifyRuntimeFailure(3, 3)).toEqual({
            ok: true,
            failureCount: 4,
            status: 'quarantined',
        });
    });

    it.each([
        [-1, 3, 'previousFailureCount'],
        [0.5, 3, 'previousFailureCount'],
        [0, 0, 'quarantineThreshold'],
        [0, 1.5, 'quarantineThreshold'],
    ] as const)(
        'rejects invalid failure policy (%s, %s)',
        (previousFailureCount, threshold, field) => {
            expect(classifyRuntimeFailure(previousFailureCount, threshold)).toEqual({
                ok: false,
                error: { code: 'invalid-runtime-failure-policy', field },
            });
        }
    );
});
