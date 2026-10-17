import { describe, expect, it } from 'vitest';
import {
    HOOK_DIAGNOSTIC_SAMPLE_CAPACITY,
    HOOK_DIAGNOSTIC_SERIES_CAPACITY,
} from '../hook-diagnostics';
import { createV1HookDiagnosticsAdapter } from '../hook-diagnostics-compat';
import { createHookEngineV2 } from '../hook-engine-v2';

describe('HookDiagnostics', () => {
    it('keeps counters and only the 128 most recent samples per series', () => {
        const adapter = createV1HookDiagnosticsAdapter({ callbacks: () => 0 });
        const { diagnostics } = adapter;
        for (let value = 0; value < 200; value++) {
            adapter.recordTiming('demo.action', value);
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
        adapter.recordError('demo.action');
        const snapshot = diagnostics.snapshot();
        for (const value of [snapshot, snapshot.series, ...snapshot.series,
            ...snapshot.series.map((entry) => entry.recent), snapshot.overflow]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
        adapter.facade.timings = {};
        adapter.facade.errors = {};
        expect(diagnostics.snapshot()).toMatchObject({
            seriesCount: 0, series: [],
            overflow: { eventCount: 0, timingCount: 0, errorCount: 0, timingTotal: 0 },
        });
    });

    it('caps total series at 2,048 and aggregates overflow without retaining names', () => {
        const adapter = createV1HookDiagnosticsAdapter({ callbacks: () => 0 });
        const { diagnostics } = adapter;
        for (let index = 0; index < HOOK_DIAGNOSTIC_SERIES_CAPACITY; index++) {
            adapter.recordTiming(`known.${index}`, index);
        }
        adapter.recordTiming('overflow.timing', 7);
        for (let index = 0; index < 1_000; index++) {
            adapter.recordError(`overflow.${index}`);
        }
        adapter.recordTiming('known.0', 10);

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
