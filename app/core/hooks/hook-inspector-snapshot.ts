import type { HookEngine } from '~~/shared/hooks/hook-engine-core';
import type { HookEngineV2 } from '~~/shared/hooks/hook-engine-v2';

export interface HookInspectorTimingStats {
    readonly count: number;
    readonly total: number;
    readonly max: number;
}

export interface HookInspectorSnapshot {
    readonly source: 'v1-facade' | 'v2-immutable';
    readonly timings: Readonly<Record<string, readonly number[]>>;
    readonly timingStats: Readonly<Record<string, HookInspectorTimingStats>>;
    readonly errors: Readonly<Record<string, number>>;
    readonly totalActions: number;
    readonly totalFilters: number;
    readonly signature: string;
}

function isV2(engine: HookEngine): engine is HookEngineV2 {
    return '_runtimeV2' in engine;
}

function immutableRecord<T>(
    entries: Iterable<readonly [string, T]>,
): Readonly<Record<string, T>> {
    return Object.freeze(Object.fromEntries(entries));
}

export function readHookInspectorSnapshot(
    engine: HookEngine,
): HookInspectorSnapshot {
    if (isV2(engine)) {
        const snapshot = engine._runtimeV2.diagnostics.snapshot();
        const timingSeries = snapshot.series.filter(
            ({ metric }) => metric === 'timing',
        );
        const errorSeries = snapshot.series.filter(
            ({ metric }) => metric === 'error',
        );
        const timings = immutableRecord(
            timingSeries.map(({ name, recent }) => [name, recent] as const),
        );
        const timingStats = immutableRecord(
            timingSeries.map(
                ({ name, count, total, max }) =>
                    [name, Object.freeze({ count, total, max })] as const,
            ),
        );
        const errors = immutableRecord(
            errorSeries.map(({ name, count }) => [name, count] as const),
        );
        return Object.freeze({
            source: 'v2-immutable',
            timings,
            timingStats,
            errors,
            totalActions: engine._runtimeV2.records.visibleCount('action'),
            totalFilters: engine._runtimeV2.records.visibleCount('filter'),
            signature: JSON.stringify([
                snapshot.series.map(({ metric, name, count }) => [
                    metric,
                    name,
                    count,
                ]),
                snapshot.overflow,
                engine._runtimeV2.records.visibleCount('action'),
                engine._runtimeV2.records.visibleCount('filter'),
            ]),
        });
    }

    const timings = immutableRecord(
        Object.entries(engine._diagnostics.timings).map(
            ([name, samples]) => [name, Object.freeze([...samples])] as const,
        ),
    );
    const timingStats = immutableRecord(
        Object.entries(timings).map(
            ([name, samples]) =>
                [
                    name,
                    Object.freeze({
                        count: samples.length,
                        total: samples.reduce((sum, sample) => sum + sample, 0),
                        max: samples.length ? Math.max(...samples) : 0,
                    }),
                ] as const,
        ),
    );
    const errors = Object.freeze({ ...engine._diagnostics.errors });
    const totalActions = engine._diagnostics.callbacks('action');
    const totalFilters = engine._diagnostics.callbacks('filter');
    return Object.freeze({
        source: 'v1-facade',
        timings,
        timingStats,
        errors,
        totalActions,
        totalFilters,
        signature: JSON.stringify([
            Object.entries(timingStats).map(([name, stats]) => [
                name,
                stats.count,
            ]),
            errors,
            totalActions,
            totalFilters,
        ]),
    });
}

export function resetHookInspectorDiagnostics(engine: HookEngine): void {
    if (isV2(engine)) {
        engine._runtimeV2.resetDiagnostics();
        return;
    }
    engine._diagnostics.timings = {};
    engine._diagnostics.errors = {};
}
