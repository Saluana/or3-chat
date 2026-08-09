import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { relative, resolve } from 'node:path';
import { createRegistry } from '../../app/composables/_registry';
import {
    listWorkspacePluginInstances,
    registerWorkspacePluginInstance,
    unregisterWorkspacePluginInstance,
} from '../../app/composables/plugins/workspace-runtime';
import { createHookEngine as createV1HookEngine } from '../../shared/hooks/hook-engine-core';
import { createHookEngineV2 } from '../../shared/hooks/hook-engine-v2';

const hookV2Mode = process.argv.includes('--v2');
const createHookEngine = hookV2Mode ? createHookEngineV2 : createV1HookEngine;

type BudgetClass =
    | 'exact'
    | 'registry'
    | 'wildcard'
    | 'reconcile'
    | 'lifecycle'
    | 'diagnostics';

interface Budgets {
    schemaVersion: number;
    baselineId: string;
    selectedRunner: RunnerFingerprint;
    measurement: {
        warmupSamples: number;
        measurementSamples: number;
        targetSampleMs: number;
        maxRepetitions: number;
    };
    budgetClasses: Record<BudgetClass, { maxMedianRatio: number }>;
    workloads: Array<{ id: string; budgetClass: BudgetClass }>;
}

interface RunnerFingerprint {
    platform: string;
    arch: string;
    cpuModel: string;
    nodeMajorMinor: string;
}

interface BenchmarkState {
    run(): void;
    teardown?(): void;
    observations?(): Record<string, number>;
}

interface BenchmarkCase {
    id: string;
    create(): BenchmarkState;
}

interface BenchmarkResult {
    id: string;
    budgetClass: BudgetClass;
    repetitions: number;
    medianNsPerOperation: number;
    p95NsPerOperation: number;
    observations?: Record<string, number>;
}

interface BenchmarkArtifact {
    schemaVersion: 1;
    baselineId: string;
    budgetSha256: string;
    runner: RunnerFingerprint;
    measurement: Budgets['measurement'];
    results: BenchmarkResult[];
}

const repoRoot = resolve(import.meta.dirname, '../..');
const budgetPath = resolve(
    repoRoot,
    'planning/complete/plugin-runtime-v2/benchmarks/budgets.json',
);
const baselinePath = resolve(
    repoRoot,
    'planning/complete/plugin-runtime-v2/benchmarks/milestone-0-v1.json',
);
const budgetSource = readFileSync(budgetPath, 'utf8');
const budgets = JSON.parse(budgetSource) as Budgets;
const budgetSha256 = createHash('sha256').update(budgetSource).digest('hex');
const mode =
    process.argv.find((arg) =>
        ['--report', '--check', '--record'].includes(arg),
    ) ?? '--report';
let sink = 0;

function nodeMajorMinor(): string {
    return process.versions.node.split('.').slice(0, 2).join('.');
}

function runnerFingerprint(): RunnerFingerprint {
    return {
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        nodeMajorMinor: nodeMajorMinor(),
    };
}

function runnerMismatch(
    expected: RunnerFingerprint,
    actual: RunnerFingerprint,
): string[] {
    return (Object.keys(expected) as Array<keyof RunnerFingerprint>)
        .filter((key) => expected[key] !== actual[key])
        .map(
            (key) =>
                `${key}: expected ${expected[key]}, received ${actual[key]}`,
        );
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percentile(values: number[], percentileValue: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[
        Math.min(
            sorted.length - 1,
            Math.ceil(sorted.length * percentileValue) - 1,
        )
    ]!;
}

function timedRun(state: BenchmarkState, repetitions: number): number {
    const started = performance.now();
    for (let index = 0; index < repetitions; index++) state.run();
    return performance.now() - started;
}

function calibratedRepetitions(testCase: BenchmarkCase): number {
    let repetitions = 1;
    while (repetitions < budgets.measurement.maxRepetitions) {
        const state = testCase.create();
        const elapsed = timedRun(state, repetitions);
        state.teardown?.();
        if (elapsed >= budgets.measurement.targetSampleMs) return repetitions;
        repetitions = Math.min(
            repetitions * 2,
            budgets.measurement.maxRepetitions,
        );
    }
    return repetitions;
}

function benchmark(
    testCase: BenchmarkCase,
    budgetClass: BudgetClass,
    fixedRepetitions?: number,
): BenchmarkResult {
    const repetitions = fixedRepetitions ?? calibratedRepetitions(testCase);
    for (let sample = 0; sample < budgets.measurement.warmupSamples; sample++) {
        const state = testCase.create();
        timedRun(state, repetitions);
        state.teardown?.();
    }

    const samples: number[] = [];
    let observations: Record<string, number> | undefined;
    for (
        let sample = 0;
        sample < budgets.measurement.measurementSamples;
        sample++
    ) {
        const state = testCase.create();
        const elapsedMs = timedRun(state, repetitions);
        observations = state.observations?.() ?? observations;
        state.teardown?.();
        samples.push((elapsedMs * 1_000_000) / repetitions);
    }

    return {
        id: testCase.id,
        budgetClass,
        repetitions,
        medianNsPerOperation: Number(median(samples).toFixed(3)),
        p95NsPerOperation: Number(percentile(samples, 0.95).toFixed(3)),
        ...(observations ? { observations } : {}),
    };
}

function actionCase(
    id: string,
    callbackCount: number,
    wildcard: boolean,
): BenchmarkCase {
    return {
        id,
        create() {
            const engine = createHookEngine();
            const registeredName = wildcard
                ? 'bench:action:*'
                : 'bench:action:exact';
            for (let index = 0; index < callbackCount; index++) {
                engine.addAction(registeredName, () => {
                    sink++;
                });
            }
            return { run: () => engine.doActionSync('bench:action:exact') };
        },
    };
}

function filterCase(callbackCount: number): BenchmarkCase {
    return {
        id: `hooks.filter.chain.${callbackCount}`,
        create() {
            const engine = createHookEngine();
            for (let index = 0; index < callbackCount; index++) {
                engine.addFilter(
                    'bench:filter:exact',
                    (value) => Number(value) + 1,
                );
            }
            return {
                run() {
                    sink += engine.applyFiltersSync('bench:filter:exact', 0);
                },
            };
        },
    };
}

function registryCase(recordCount: number): BenchmarkCase {
    const ids = Array.from(
        { length: recordCount },
        (_, index) => `bench-registry-${recordCount}-${index}`,
    );
    const globalKey = `__or3_plugin_runtime_bench_${recordCount}`;
    return {
        id: `registry.commit-dispose.${recordCount}`,
        create() {
            const registry = createRegistry<{ id: string; order: number }>(
                globalKey,
            );
            for (const id of ids) registry.unregister(id);
            return {
                run() {
                    const handles = ids.map((id, order) =>
                        registry.register({ id, order }),
                    );
                    for (let index = handles.length - 1; index >= 0; index--)
                        handles[index]!.dispose();
                },
                teardown() {
                    for (const id of ids) registry.unregister(id);
                },
            };
        },
    };
}

const reconcileIds = Array.from(
    { length: 150 },
    (_, index) => `bench-reconcile-${index}`,
);

function clearBenchmarkPluginInstances(): void {
    for (const plugin of listWorkspacePluginInstances()) {
        if (plugin.id.startsWith('bench-'))
            unregisterWorkspacePluginInstance(plugin.id);
    }
}

function reconcileCase(): BenchmarkCase {
    return {
        id: 'runtime.reconcile.100',
        create() {
            clearBenchmarkPluginInstances();
            let active = new Set<string>();
            let useSecondSet = false;
            return {
                run() {
                    const desired = new Set(
                        useSecondSet
                            ? reconcileIds.slice(50)
                            : reconcileIds.slice(0, 100),
                    );
                    for (const id of active) {
                        if (!desired.has(id))
                            unregisterWorkspacePluginInstance(id);
                    }
                    for (const id of desired) {
                        if (!active.has(id))
                            registerWorkspacePluginInstance(
                                id,
                                'extension',
                                () => {},
                            );
                    }
                    active = desired;
                    useSecondSet = !useSecondSet;
                    sink += active.size;
                },
                teardown: clearBenchmarkPluginInstances,
            };
        },
    };
}

function enableDisableCase(): BenchmarkCase {
    const id = 'bench-enable-disable';
    return {
        id: 'runtime.enable-disable.1000',
        create() {
            unregisterWorkspacePluginInstance(id);
            return {
                run() {
                    for (let cycle = 0; cycle < 1_000; cycle++) {
                        registerWorkspacePluginInstance(
                            id,
                            'extension',
                            () => {},
                        );
                        unregisterWorkspacePluginInstance(id);
                    }
                    sink++;
                },
                teardown: () => unregisterWorkspacePluginInstance(id),
            };
        },
    };
}

function diagnosticsCase(): BenchmarkCase {
    return {
        id: 'diagnostics.long-session',
        create() {
            let observations: Record<string, number> = {};
            return {
                run() {
                    const engine = createHookEngine();
                    engine.addAction('bench:diagnostics:hot', () => {
                        sink++;
                    });
                    for (let sample = 0; sample < 10_000; sample++) {
                        engine.doActionSync('bench:diagnostics:hot');
                    }
                    for (let series = 0; series < 2_500; series++) {
                        const name = `bench:diagnostics:series:${series}`;
                        engine.addAction(name, () => {
                            sink++;
                        });
                        engine.doActionSync(name);
                    }
                    const timingSeries = Object.keys(
                        engine._diagnostics.timings,
                    ).length;
                    const timingSamples = Object.values(
                        engine._diagnostics.timings,
                    ).reduce((total, values) => total + values.length, 0);
                    observations = {
                        legacyTimingSeries: timingSeries,
                        legacyTimingSamples: timingSamples,
                        legacyEstimatedSampleBytes:
                            timingSamples * Float64Array.BYTES_PER_ELEMENT,
                    };
                },
                observations: () => observations,
            };
        },
    };
}

const allCases: BenchmarkCase[] = [
    ...[0, 1, 10, 100, 1_000].map((count) =>
        actionCase(`hooks.action.exact.${count}`, count, false),
    ),
    ...[1, 10, 100, 1_000].map(filterCase),
    ...[0, 10, 100, 1_000].map((count) =>
        actionCase(`hooks.action.wildcard.${count}`, count, true),
    ),
    registryCase(1),
    registryCase(100),
    reconcileCase(),
    enableDisableCase(),
    diagnosticsCase(),
];
const cases = hookV2Mode
    ? allCases.filter((testCase) => testCase.id.startsWith('hooks.'))
    : allCases;

function validateMatrix(): Map<string, BudgetClass> {
    const configured = new Map(
        budgets.workloads.map((workload) => [
            workload.id,
            workload.budgetClass,
        ]),
    );
    const implemented = new Set(cases.map((testCase) => testCase.id));
    const missing = hookV2Mode
        ? []
        : budgets.workloads.filter((workload) => !implemented.has(workload.id));
    const extra = cases.filter((testCase) => !configured.has(testCase.id));
    if (missing.length || extra.length) {
        throw new Error(
            `benchmark matrix mismatch; missing=${missing.map(({ id }) => id).join(',') || 'none'} extra=${extra.map(({ id }) => id).join(',') || 'none'}`,
        );
    }
    return configured;
}

function printResults(results: BenchmarkResult[]): void {
    console.table(
        results.map((result) => ({
            workload: result.id,
            class: result.budgetClass,
            repetitions: result.repetitions,
            'median ns/op': result.medianNsPerOperation,
            'p95 ns/op': result.p95NsPerOperation,
        })),
    );
}

function checkResults(
    artifact: BenchmarkArtifact,
    baseline: BenchmarkArtifact,
): void {
    if (baseline.budgetSha256 !== budgetSha256) {
        throw new Error(
            'benchmark budget changed without re-recording the reviewed Milestone 0 baseline',
        );
    }
    const mismatches = runnerMismatch(baseline.runner, artifact.runner);
    if (mismatches.length) {
        throw new Error(
            `benchmark runner does not match the stored baseline:\n${mismatches.join('\n')}`,
        );
    }
    const previous = new Map(
        baseline.results.map((result) => [result.id, result]),
    );
    const failures: string[] = [];
    for (const result of artifact.results) {
        const baselineResult = previous.get(result.id);
        if (!baselineResult) {
            failures.push(`${result.id}: missing baseline`);
            continue;
        }
        const maxRatio =
            budgets.budgetClasses[result.budgetClass].maxMedianRatio;
        const ratio =
            result.medianNsPerOperation / baselineResult.medianNsPerOperation;
        if (ratio > maxRatio) {
            failures.push(
                `${result.id}: ${(ratio * 100).toFixed(1)}% of baseline exceeds ${(maxRatio * 100).toFixed(1)}%`,
            );
        }
        if (
            JSON.stringify(result.observations ?? {}) !==
            JSON.stringify(baselineResult.observations ?? {})
        ) {
            failures.push(`${result.id}: structural observations changed`);
        }
    }
    if (failures.length)
        throw new Error(
            `plugin runtime benchmark budget failed:\n${failures.join('\n')}`,
        );
}

const configured = validateMatrix();
const actualRunner = runnerFingerprint();
const selectedRunnerMismatches = runnerMismatch(
    budgets.selectedRunner,
    actualRunner,
);
if (selectedRunnerMismatches.length) {
    throw new Error(
        `run benchmarks on the selected runner:\n${selectedRunnerMismatches.join('\n')}`,
    );
}

const checkBaseline =
    mode === '--check'
        ? (JSON.parse(
              readFileSync(baselinePath, 'utf8'),
          ) as BenchmarkArtifact)
        : undefined;
const checkRepetitions = new Map(
    checkBaseline?.results.map((result) => [result.id, result.repetitions]) ?? [],
);
const results = cases.map((testCase) =>
    benchmark(
        testCase,
        configured.get(testCase.id)!,
        checkRepetitions.get(testCase.id),
    ),
);
const artifact: BenchmarkArtifact = {
    schemaVersion: 1,
    baselineId: budgets.baselineId,
    budgetSha256,
    runner: actualRunner,
    measurement: budgets.measurement,
    results,
};

printResults(results);
if (mode === '--record') {
    writeFileSync(baselinePath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(
        `[plugin-runtime-benchmarks] recorded ${relative(repoRoot, baselinePath)}`,
    );
} else if (mode === '--check') {
    checkResults(artifact, checkBaseline!);
    console.log(
        `[plugin-runtime-benchmarks] ${results.length} workloads are within the Milestone 0 budgets`,
    );
} else {
    console.log('PLUGIN_RUNTIME_BENCHMARK_ARTIFACT');
    console.log(JSON.stringify(artifact, null, 2));
}

// Keep callback work observable to the runtime without polluting the artifact.
if (sink === Number.MIN_SAFE_INTEGER) console.log(sink);
