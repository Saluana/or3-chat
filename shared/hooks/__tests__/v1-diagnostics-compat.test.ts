import { describe, expect, it } from 'vitest';
import { createHookEngine } from '../hook-engine-core';

describe('V1 _diagnostics compatibility fixture', () => {
    it('preserves direct plugin reads, unbounded samples, resets, errors, and callback counts', () => {
        const engine = createHookEngine();
        const sampleCount = 1_025;
        const timingHook = 'fixture:action:timings';
        const errorHook = 'fixture:action:errors';

        engine.addAction(timingHook, () => undefined);
        engine.addAction('fixture:action:*', () => undefined);
        engine.addFilter('fixture:filter:value', (value) => value);
        engine.addAction(errorHook, () => {
            throw new Error('fixture failure');
        });

        for (let index = 0; index < sampleCount; index += 1) {
            engine.doActionSync(timingHook);
        }
        engine.doActionSync(errorHook);
        engine.doActionSync(errorHook);

        expect(engine._diagnostics.timings[timingHook]).toHaveLength(sampleCount * 2);
        expect(engine._diagnostics.timings[timingHook]?.every(Number.isFinite)).toBe(true);
        expect(engine._diagnostics.errors[errorHook]).toBe(2);
        expect(engine._diagnostics.callbacks()).toBe(4);
        expect(engine._diagnostics.callbacks('action')).toBe(3);
        expect(engine._diagnostics.callbacks('filter')).toBe(1);

        const oldTimings = engine._diagnostics.timings;
        const oldErrors = engine._diagnostics.errors;
        engine._diagnostics.timings = {};
        engine._diagnostics.errors = {};

        expect(engine._diagnostics.timings).toEqual({});
        expect(engine._diagnostics.errors).toEqual({});
        expect(oldTimings[timingHook]).toHaveLength(sampleCount * 2);
        expect(oldErrors[errorHook]).toBe(2);

        engine.doActionSync(timingHook);
        expect(engine._diagnostics.timings[timingHook]).toHaveLength(2);
        expect(oldTimings[timingHook]).toHaveLength(sampleCount * 2);
    });
});
