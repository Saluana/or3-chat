import {
    HOOK_DIAGNOSTIC_SAMPLE_CAPACITY,
    HOOK_DIAGNOSTIC_SERIES_CAPACITY,
    HookDiagnostics,
} from './hook-diagnostics';
import type { HookEngine, HookKind } from './hook-engine-core';

export interface V1HookDiagnosticsAdapter {
    readonly diagnostics: HookDiagnostics;
    readonly facade: HookEngine['_diagnostics'];
    recordTiming(name: string, milliseconds: number): void;
    recordError(name: string): void;
}

/** Mutable V1 shape backed in parallel by bounded V2 metrics. */
export function createV1HookDiagnosticsAdapter(options: {
    callbacks(kind?: HookKind): number;
}): V1HookDiagnosticsAdapter {
    let timings: Record<string, number[]> = {};
    let timingStats: Record<
        string,
        { count: number; total: number; min: number; max: number }
    > = {};
    let errors: Record<string, number> = {};
    const overflow = {
        eventCount: 0,
        timingCount: 0,
        errorCount: 0,
        timingTotal: 0,
    };

    const resetTimingOverflow = () => {
        overflow.eventCount -= overflow.timingCount;
        overflow.timingCount = 0;
        overflow.timingTotal = 0;
    };
    const resetErrorOverflow = () => {
        overflow.eventCount -= overflow.errorCount;
        overflow.errorCount = 0;
    };
    const replaceTimings = (next: Record<string, number[]>) => {
        timings = {};
        timingStats = {};
        resetTimingOverflow();
        for (const [name, samples] of Object.entries(next)) {
            let total = 0;
            let min = Number.POSITIVE_INFINITY;
            let max = Number.NEGATIVE_INFINITY;
            for (const sample of samples) {
                total += sample;
                min = Math.min(min, sample);
                max = Math.max(max, sample);
            }
            if (
                Object.keys(timings).length >= HOOK_DIAGNOSTIC_SERIES_CAPACITY
            ) {
                overflow.eventCount += samples.length;
                overflow.timingCount += samples.length;
                overflow.timingTotal += total;
                continue;
            }
            timings[name] = samples.slice(-HOOK_DIAGNOSTIC_SAMPLE_CAPACITY);
            timingStats[name] = {
                count: samples.length,
                total,
                min: samples.length ? min : 0,
                max: samples.length ? max : 0,
            };
        }
    };
    const replaceErrors = (next: Record<string, number>) => {
        errors = {};
        resetErrorOverflow();
        for (const [name, count] of Object.entries(next)) {
            if (Object.keys(errors).length >= HOOK_DIAGNOSTIC_SERIES_CAPACITY) {
                overflow.eventCount += count;
                overflow.errorCount += count;
                continue;
            }
            errors[name] = count;
        }
    };
    const diagnostics = new HookDiagnostics({
        legacySource: {
            read: () => ({ timings, timingStats, errors, overflow }),
            reset(metric) {
                if (metric === undefined || metric === 'timing') {
                    replaceTimings({});
                }
                if (metric === undefined || metric === 'error') {
                    replaceErrors({});
                }
            },
        },
    });
    const facade = {
        callbacks: options.callbacks,
    } as HookEngine['_diagnostics'];

    Object.defineProperties(facade, {
        timings: {
            enumerable: true,
            configurable: false,
            get: () => timings,
            set: (next: Record<string, number[]>) => {
                replaceTimings(next);
            },
        },
        errors: {
            enumerable: true,
            configurable: false,
            get: () => errors,
            set: (next: Record<string, number>) => {
                replaceErrors(next);
            },
        },
    });

    return Object.freeze({
        diagnostics,
        facade,
        recordTiming(name: string, milliseconds: number) {
            const stats = timingStats[name];
            if (!stats) {
                if (
                    Object.keys(timingStats).length >=
                    HOOK_DIAGNOSTIC_SERIES_CAPACITY
                ) {
                    overflow.eventCount += 1;
                    overflow.timingCount += 1;
                    overflow.timingTotal += milliseconds;
                    return;
                }
                timingStats[name] = {
                    count: 1,
                    total: milliseconds,
                    min: milliseconds,
                    max: milliseconds,
                };
                timings[name] = [milliseconds];
                return;
            }
            stats.count += 1;
            stats.total += milliseconds;
            stats.min = Math.min(stats.min, milliseconds);
            stats.max = Math.max(stats.max, milliseconds);
            const samples = timings[name] ?? (timings[name] = []);
            if (samples.length >= HOOK_DIAGNOSTIC_SAMPLE_CAPACITY) {
                samples.shift();
            }
            samples.push(milliseconds);
        },
        recordError(name: string) {
            if (Object.hasOwn(errors, name)) {
                errors[name] = errors[name]! + 1;
                return;
            }
            if (Object.keys(errors).length >= HOOK_DIAGNOSTIC_SERIES_CAPACITY) {
                overflow.eventCount += 1;
                overflow.errorCount += 1;
                return;
            }
            errors[name] = 1;
        },
    });
}
