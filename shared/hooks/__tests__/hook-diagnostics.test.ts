import { describe, expect, it } from 'vitest';
import {
    HOOK_DIAGNOSTIC_SAMPLE_CAPACITY,
    HOOK_DIAGNOSTIC_SERIES_CAPACITY,
    HookDiagnostics,
} from '../hook-diagnostics';
import { createHookEngineV2 } from '../hook-engine-v2';

describe('HookDiagnostics', () => {
    it('keeps counters and only the 128 most recent samples per series', () => {
        const diagnostics = new HookDiagnostics();
        for (let value = 0; value < 200; value++) {
            diagnostics.recordTiming('demo.action', value);
        }

        const [series] = diagnostics.snapshot().series;
        expect(series).toMatchObject({
            metric: 'timing',
            name: 'demo.action',
            count: 200,
            total: 19_900,
            min: 0,
            max: 199,
        });
        expect(series?.recent).toHaveLength(HOOK_DIAGNOSTIC_SAMPLE_CAPACITY);
        expect(series?.recent[0]).toBe(72);
        expect(series?.recent.at(-1)).toBe(199);
    });

    it('caps total series at 2,048 and aggregates overflow without retaining names', () => {
        const diagnostics = new HookDiagnostics();
        for (let index = 0; index < HOOK_DIAGNOSTIC_SERIES_CAPACITY; index++) {
            diagnostics.recordTiming(`known.${index}`, index);
        }
        diagnostics.recordTiming('overflow.timing', 7);
        for (let index = 0; index < 1_000; index++) {
            diagnostics.recordError(`overflow.${index}`);
        }
        diagnostics.recordTiming('known.0', 10);

        const snapshot = diagnostics.snapshot();
        expect(snapshot.seriesCount).toBe(HOOK_DIAGNOSTIC_SERIES_CAPACITY);
        expect(snapshot.series).toHaveLength(HOOK_DIAGNOSTIC_SERIES_CAPACITY);
        expect(
            snapshot.series.some(({ name }) => name.startsWith('overflow.')),
        ).toBe(false);
        expect(snapshot.overflow).toEqual({
            eventCount: 1_001,
            timingCount: 1,
            errorCount: 1_000,
            timingTotal: 7,
        });
        expect(
            snapshot.series.find(({ name }) => name === 'known.0')?.count,
        ).toBe(2);
    });

    it('returns deeply immutable snapshots and resets all bounded state', () => {
        const diagnostics = new HookDiagnostics();
        diagnostics.recordTiming('demo.action', 3);
        diagnostics.recordError('demo.action');

        const snapshot = diagnostics.snapshot();
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.series)).toBe(true);
        expect(Object.isFrozen(snapshot.series[0])).toBe(true);
        expect(Object.isFrozen(snapshot.series[0]?.recent)).toBe(true);
        expect(Object.isFrozen(snapshot.overflow)).toBe(true);

        diagnostics.reset();

        expect(diagnostics.snapshot()).toMatchObject({
            seriesCount: 0,
            series: [],
            overflow: {
                eventCount: 0,
                timingCount: 0,
                errorCount: 0,
                timingTotal: 0,
            },
        });
    });

    it('records executor timings and errors in the bounded runtime diagnostics', async () => {
        const engine = createHookEngineV2();
        engine.addAction('demo.action', () => {
            throw new Error('record me');
        });

        await engine.doAction('demo.action');

        expect(
            engine._runtimeV2.diagnostics
                .snapshot()
                .series.map(({ metric, name, count }) => ({
                    metric,
                    name,
                    count,
                })),
        ).toEqual([
            { metric: 'error', name: 'demo.action', count: 1 },
            { metric: 'timing', name: 'demo.action', count: 1 },
        ]);
    });

    it('maps V1 reset assignments onto the matching bounded metric projection', () => {
        const engine = createHookEngineV2();
        engine.addAction('demo.action', () => {
            throw new Error('record me');
        });
        engine.doActionSync('demo.action');
        expect(engine._runtimeV2.diagnostics.snapshot().series).toHaveLength(2);

        engine._diagnostics.timings = {};
        expect(
            engine._runtimeV2.diagnostics
                .snapshot()
                .series.map(({ metric }) => metric),
        ).toEqual(['error']);
        engine._diagnostics.errors = {};
        expect(engine._runtimeV2.diagnostics.snapshot().series).toEqual([]);
    });
});
