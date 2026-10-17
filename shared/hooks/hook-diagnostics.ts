export const HOOK_DIAGNOSTIC_SAMPLE_CAPACITY = 128;
export const HOOK_DIAGNOSTIC_SERIES_CAPACITY = 2_048;

export type HookMetricKind = 'timing' | 'error';

export interface HookMetricSeriesSnapshot {
    readonly metric: HookMetricKind;
    readonly name: string;
    readonly count: number;
    readonly total: number;
    readonly min: number;
    readonly max: number;
    readonly recent: readonly number[];
}

export interface HookMetricOverflowSnapshot {
    readonly eventCount: number;
    readonly timingCount: number;
    readonly errorCount: number;
    readonly timingTotal: number;
}

export interface HookDiagnosticsSnapshot {
    readonly seriesCapacity: number;
    readonly sampleCapacity: number;
    readonly seriesCount: number;
    readonly series: readonly HookMetricSeriesSnapshot[];
    readonly overflow: HookMetricOverflowSnapshot;
}

export interface HookDiagnosticsLegacySource {
    read(): {
        readonly timings: Readonly<Record<string, readonly number[]>>;
        readonly timingStats?: Readonly<
            Record<
                string,
                Readonly<{
                    count: number;
                    total: number;
                    min: number;
                    max: number;
                }>
            >
        >;
        readonly errors: Readonly<Record<string, number>>;
        readonly overflow?: HookMetricOverflowSnapshot;
    };
}

/** Immutable projection of the live hook diagnostics adapter. */
export class HookDiagnostics {
    readonly #legacySource: HookDiagnosticsLegacySource;

    constructor(options: { legacySource: HookDiagnosticsLegacySource }) {
        this.#legacySource = options.legacySource;
    }

    snapshot(): HookDiagnosticsSnapshot {
        return this.#legacySnapshot();
    }

    #legacySnapshot(): HookDiagnosticsSnapshot {
        const source = this.#legacySource.read();
        const series: HookMetricSeriesSnapshot[] = [];
        let overflowEventCount = source.overflow?.eventCount ?? 0;
        let overflowTimingCount = source.overflow?.timingCount ?? 0;
        let overflowErrorCount = source.overflow?.errorCount ?? 0;
        let overflowTimingTotal = source.overflow?.timingTotal ?? 0;
        const append = (snapshot: HookMetricSeriesSnapshot) => {
            if (series.length < HOOK_DIAGNOSTIC_SERIES_CAPACITY) {
                series.push(Object.freeze(snapshot));
                return;
            }
            overflowEventCount += snapshot.count;
            if (snapshot.metric === 'timing') {
                overflowTimingCount += snapshot.count;
                overflowTimingTotal += snapshot.total;
            } else {
                overflowErrorCount += snapshot.count;
            }
        };
        for (const [name, samples] of Object.entries(source.timings)) {
            const aggregate = source.timingStats?.[name];
            let total = 0;
            let min = Number.POSITIVE_INFINITY;
            let max = Number.NEGATIVE_INFINITY;
            for (const sample of samples) {
                total += sample;
                min = Math.min(min, sample);
                max = Math.max(max, sample);
            }
            const recent = Object.freeze(
                samples.slice(-HOOK_DIAGNOSTIC_SAMPLE_CAPACITY),
            );
            append({
                metric: 'timing',
                name,
                count: aggregate?.count ?? samples.length,
                total: aggregate?.total ?? total,
                min: aggregate?.min ?? (samples.length ? min : 0),
                max: aggregate?.max ?? (samples.length ? max : 0),
                recent,
            });
        }
        for (const [name, count] of Object.entries(source.errors)) {
            append({
                metric: 'error',
                name,
                count,
                total: count,
                min: count ? 1 : 0,
                max: count ? 1 : 0,
                recent: Object.freeze(
                    Array.from(
                        { length: Math.min(count, HOOK_DIAGNOSTIC_SAMPLE_CAPACITY) },
                        () => 1,
                    ),
                ),
            });
        }
        series.sort(
            (left, right) =>
                left.metric.localeCompare(right.metric) ||
                left.name.localeCompare(right.name),
        );
        return Object.freeze({
            seriesCapacity: HOOK_DIAGNOSTIC_SERIES_CAPACITY,
            sampleCapacity: HOOK_DIAGNOSTIC_SAMPLE_CAPACITY,
            seriesCount: series.length,
            series: Object.freeze(series),
            overflow: Object.freeze({
                eventCount: overflowEventCount,
                timingCount: overflowTimingCount,
                errorCount: overflowErrorCount,
                timingTotal: overflowTimingTotal,
            }),
        });
    }
}
