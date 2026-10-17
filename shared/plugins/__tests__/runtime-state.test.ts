import { describe, expect, it } from 'vitest';
import { classifyRuntimeFailure } from '../runtime-state';

describe('plugin runtime failure policy', () => {
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
