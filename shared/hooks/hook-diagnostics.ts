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

interface HookMetricSeriesState {
    readonly metric: HookMetricKind;
    readonly name: string;
    count: number;
    total: number;
    min: number;
    max: number;
    readonly recent: number[];
    nextSample: number;
}

export interface HookDiagnosticsLegacySource {
    read(): {
        readonly timings: Readonly<Record<string, readonly number[]>>;
        readonly errors: Readonly<Record<string, number>>;
    };
    reset(metric?: HookMetricKind): void;
}

function seriesKey(metric: HookMetricKind, name: string): string {
    return JSON.stringify([metric, name]);
}

function recentSnapshot(state: HookMetricSeriesState): readonly number[] {
    if (state.recent.length < HOOK_DIAGNOSTIC_SAMPLE_CAPACITY) {
        return Object.freeze([...state.recent]);
    }
    return Object.freeze([
        ...state.recent.slice(state.nextSample),
        ...state.recent.slice(0, state.nextSample),
    ]);
}

/** Bounded metric storage for Hook Runtime V2. */
export class HookDiagnostics {
    readonly #series = new Map<string, HookMetricSeriesState>();
    readonly #legacySource?: HookDiagnosticsLegacySource;
    #overflowEventCount = 0;
    #overflowTimingCount = 0;
    #overflowErrorCount = 0;
    #overflowTimingTotal = 0;

    constructor(options: { legacySource?: HookDiagnosticsLegacySource } = {}) {
        this.#legacySource = options.legacySource;
    }

    recordTiming(name: string, milliseconds: number): void {
        this.#record('timing', name, milliseconds);
    }

    recordError(name: string): void {
        this.#record('error', name, 1);
    }

    snapshot(): HookDiagnosticsSnapshot {
        if (this.#legacySource) return this.#legacySnapshot();
        const series = Array.from(this.#series.values(), (state) =>
            Object.freeze({
                metric: state.metric,
                name: state.name,
                count: state.count,
                total: state.total,
                min: state.min,
                max: state.max,
                recent: recentSnapshot(state),
            }),
        );
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
                eventCount: this.#overflowEventCount,
                timingCount: this.#overflowTimingCount,
                errorCount: this.#overflowErrorCount,
                timingTotal: this.#overflowTimingTotal,
            }),
        });
    }

    reset(metric?: HookMetricKind): void {
        if (this.#legacySource) {
            this.#legacySource.reset(metric);
            return;
        }
        if (metric === undefined) {
            this.#series.clear();
            this.#overflowEventCount = 0;
            this.#overflowTimingCount = 0;
            this.#overflowErrorCount = 0;
            this.#overflowTimingTotal = 0;
            return;
        }
        for (const [key, state] of this.#series) {
            if (state.metric === metric) this.#series.delete(key);
        }
        if (metric === 'timing') {
            this.#overflowEventCount -= this.#overflowTimingCount;
            this.#overflowTimingCount = 0;
            this.#overflowTimingTotal = 0;
        } else {
            this.#overflowEventCount -= this.#overflowErrorCount;
            this.#overflowErrorCount = 0;
        }
    }

    #record(metric: HookMetricKind, name: string, value: number): void {
        if (this.#legacySource) return;
        const key = seriesKey(metric, name);
        let state = this.#series.get(key);
        if (!state) {
            if (this.#series.size >= HOOK_DIAGNOSTIC_SERIES_CAPACITY) {
                this.#overflowEventCount += 1;
                if (metric === 'timing') {
                    this.#overflowTimingCount += 1;
                    this.#overflowTimingTotal += value;
                } else {
                    this.#overflowErrorCount += 1;
                }
                return;
            }
            state = {
                metric,
                name,
                count: 0,
                total: 0,
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                recent: [],
                nextSample: 0,
            };
            this.#series.set(key, state);
        }
        state.count += 1;
        state.total += value;
        state.min = Math.min(state.min, value);
        state.max = Math.max(state.max, value);
        if (state.recent.length < HOOK_DIAGNOSTIC_SAMPLE_CAPACITY) {
            state.recent.push(value);
            state.nextSample =
                state.recent.length % HOOK_DIAGNOSTIC_SAMPLE_CAPACITY;
        } else {
            state.recent[state.nextSample] = value;
            state.nextSample =
                (state.nextSample + 1) % HOOK_DIAGNOSTIC_SAMPLE_CAPACITY;
        }
    }

    #legacySnapshot(): HookDiagnosticsSnapshot {
        const source = this.#legacySource!.read();
        const series: HookMetricSeriesSnapshot[] = [];
        let overflowEventCount = 0;
        let overflowTimingCount = 0;
        let overflowErrorCount = 0;
        let overflowTimingTotal = 0;
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
                count: samples.length,
                total,
                min: samples.length ? min : 0,
                max: samples.length ? max : 0,
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
                    Array(
                        Math.min(count, HOOK_DIAGNOSTIC_SAMPLE_CAPACITY),
                    ).fill(1),
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
