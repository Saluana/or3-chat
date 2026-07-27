import { createHash } from 'node:crypto';

export const CANARY_SCHEMA_VERSION = 'or3.staging-canary.v1' as const;

export type ProviderTopology = {
    instances: number;
    syncProvider: string;
    storageProvider: string;
    backgroundProvider: string;
    sqliteTopology?: 'single-writer' | 'supported-shared-volume' | 'unsupported';
    fsTopology?: 'single-writer' | 'supported-shared-volume' | 'unsupported';
    viewerSuppressionRequiredForCorrectness?: boolean;
};

export type CanaryHttpStep = {
    id: string;
    method?: string;
    path: string;
    instance?: string;
    headers?: Record<string, string>;
    body?: unknown;
    /** Per-request deadline. Defaults to 15 seconds and is capped at 60 seconds. */
    timeoutMs?: number;
    /** Declares the dependency exercised by a failure-injection step. */
    faultTarget?:
        | 'convex'
        | 'object-storage'
        | 'openrouter'
        | 'network-partition'
        | 'partial-provider-outage';
    /** Failure-injection evidence must pair injection with recovery. */
    faultPhase?: 'inject' | 'recover';
    expect?: {
        status?: number;
        json?: Record<string, unknown>;
    };
};

export type CanaryScenarioName =
    | 'auth'
    | 'sync'
    | 'storage'
    | 'backgroundJobs'
    | 'backupRestore'
    | 'rollback'
    | 'rollingRestart'
    | 'failureInjection'
    | 'shortSoak';

export type StagingCanaryConfig = {
    baseUrl: string;
    artifact: {
        candidate: string;
        previous: string;
        providerDataSnapshot: string;
    };
    topology: ProviderTopology;
    requestHeaders?: Record<string, string>;
    /** Repeats the shortSoak scenario; constrained to 2-25 cycles. */
    shortSoakCycles: number;
    scenarios: Record<CanaryScenarioName, CanaryHttpStep[]>;
};

export type CanaryStepEvidence = {
    id: string;
    scenario: 'health' | CanaryScenarioName;
    instance?: string;
    method: string;
    url: string;
    status: 'passed' | 'failed';
    httpStatus?: number;
    durationMs: number;
    error?: string;
};

export type CanaryEvidence = {
    schemaVersion: typeof CANARY_SCHEMA_VERSION;
    status: 'passed' | 'failed';
    startedAt: string;
    finishedAt: string;
    artifact: StagingCanaryConfig['artifact'];
    topology: ProviderTopology;
    topologyErrors: string[];
    steps: CanaryStepEvidence[];
    summary: {
        passed: number;
        failed: number;
        evidenceSha256: string;
    };
};

type RunOptions = {
    fetchImpl?: typeof fetch;
    now?: () => Date;
};

function isExternalProvider(provider: string): boolean {
    return !['', 'memory', 'sqlite', 'fs'].includes(provider.trim().toLowerCase());
}

export function validateProductionTopology(
    topology: ProviderTopology
): string[] {
    const errors: string[] = [];
    if (!Number.isInteger(topology.instances) || topology.instances < 1) {
        errors.push('topology.instances must be a positive integer');
        return errors;
    }
    if (topology.instances === 1) return errors;

    if (topology.backgroundProvider === 'memory') {
        errors.push(
            'multi-instance deployments require an external background-job provider'
        );
    }
    if (
        !isExternalProvider(topology.backgroundProvider) &&
        topology.backgroundProvider !== 'memory'
    ) {
        errors.push(
            `background provider "${topology.backgroundProvider}" is not declared external`
        );
    }
    if (topology.viewerSuppressionRequiredForCorrectness) {
        errors.push(
            'process-local viewer suppression cannot be required for correctness'
        );
    }
    if (
        topology.syncProvider === 'sqlite' &&
        !['single-writer', 'supported-shared-volume'].includes(
            topology.sqliteTopology ?? 'unsupported'
        )
    ) {
        errors.push(
            'SQLite in multi-instance mode requires an explicit single-writer or supported shared-volume topology'
        );
    }
    if (
        topology.storageProvider === 'fs' &&
        !['single-writer', 'supported-shared-volume'].includes(
            topology.fsTopology ?? 'unsupported'
        )
    ) {
        errors.push(
            'filesystem storage in multi-instance mode requires an explicit single-writer or supported shared-volume topology'
        );
    }
    return errors;
}

function readPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, part) => {
        if (!current || typeof current !== 'object') return undefined;
        return (current as Record<string, unknown>)[part];
    }, value);
}

function sameJsonValue(actual: unknown, expected: unknown): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateConfig(config: StagingCanaryConfig): void {
    if (!config.baseUrl) throw new Error('baseUrl is required');
    for (const field of ['candidate', 'previous', 'providerDataSnapshot'] as const) {
        if (!config.artifact?.[field]) {
            throw new Error(`artifact.${field} is required`);
        }
    }
    for (const name of [
        'auth',
        'sync',
        'storage',
        'backgroundJobs',
        'backupRestore',
        'rollback',
        'rollingRestart',
        'failureInjection',
        'shortSoak',
    ] as const) {
        if (!config.scenarios?.[name]?.length) {
            throw new Error(`scenarios.${name} must contain at least one step`);
        }
    }
    if (
        !Number.isInteger(config.shortSoakCycles) ||
        config.shortSoakCycles < 2 ||
        config.shortSoakCycles > 25
    ) {
        throw new Error('shortSoakCycles must be an integer between 2 and 25');
    }
    if (config.shortSoakCycles * config.scenarios.shortSoak.length > 100) {
        throw new Error('shortSoak is limited to 100 total requests');
    }
    const requiredFaultTargets = new Set<NonNullable<CanaryHttpStep['faultTarget']>>([
        'convex',
        'object-storage',
        'openrouter',
        'network-partition',
        'partial-provider-outage',
    ]);
    for (const step of config.scenarios.failureInjection) {
        if (step.faultTarget) requiredFaultTargets.delete(step.faultTarget);
    }
    if (requiredFaultTargets.size) {
        throw new Error(
            `failureInjection is missing targets: ${[...requiredFaultTargets].join(', ')}`
        );
    }
    for (const target of [
        'convex',
        'object-storage',
        'openrouter',
        'network-partition',
        'partial-provider-outage',
    ] as const) {
        const phases = new Set(
            config.scenarios.failureInjection
                .filter((step) => step.faultTarget === target)
                .map((step) => step.faultPhase)
        );
        if (!phases.has('inject') || !phases.has('recover')) {
            throw new Error(
                `failureInjection target ${target} requires inject and recover phases`
            );
        }
    }
    for (const steps of Object.values(config.scenarios)) {
        for (const step of steps) {
            if (
                step.timeoutMs !== undefined &&
                (!Number.isInteger(step.timeoutMs) ||
                    step.timeoutMs < 1 ||
                    step.timeoutMs > 60_000)
            ) {
                throw new Error(
                    `${step.id}.timeoutMs must be an integer between 1 and 60000`
                );
            }
        }
    }
}

export async function runStagingCanary(
    config: StagingCanaryConfig,
    options: RunOptions = {}
): Promise<CanaryEvidence> {
    validateConfig(config);
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? (() => new Date());
    const startedAt = now().toISOString();
    const topologyErrors = validateProductionTopology(config.topology);
    if (config.topology.instances > 1) {
        const exercisedInstances = new Set(
            config.scenarios.rollingRestart
                .map((step) => step.instance)
                .filter((instance): instance is string => Boolean(instance))
        );
        if (exercisedInstances.size < 2) {
            topologyErrors.push(
                'rolling-restart evidence must exercise at least two named instances'
            );
        }
        const soakInstances = new Set(
            config.scenarios.shortSoak
                .map((step) => step.instance)
                .filter((instance): instance is string => Boolean(instance))
        );
        if (soakInstances.size < 2) {
            topologyErrors.push(
                'multi-instance short-soak evidence must exercise at least two named instances'
            );
        }
    }
    const steps: CanaryStepEvidence[] = [];
    const configuredScenarios = Object.entries(config.scenarios).flatMap(
        ([scenario, steps]): Array<[CanaryScenarioName, CanaryHttpStep[]]> => {
            const name = scenario as CanaryScenarioName;
            if (name !== 'shortSoak') return [[name, steps]];
            return Array.from(
                { length: config.shortSoakCycles },
                (_, cycle): [CanaryScenarioName, CanaryHttpStep[]] => [
                    'shortSoak',
                    steps.map((step) => ({
                        ...step,
                        id: `${step.id}@${cycle + 1}`,
                    })),
                ]
            );
        }
    );
    const allScenarios: Array<['health' | CanaryScenarioName, CanaryHttpStep[]]> = [
        [
            'health',
            [
                {
                    id: 'deep-health',
                    path: '/api/health?deep=true',
                    expect: { status: 200, json: { status: 'ok' } },
                },
            ],
        ],
        ...configuredScenarios,
    ];

    for (const [scenario, scenarioSteps] of allScenarios) {
        for (const step of scenarioSteps) {
            const method = step.method?.toUpperCase() ?? 'GET';
            const url = new URL(step.path, config.baseUrl).toString();
            const stepStarted = performance.now();
            try {
                const response = await fetchImpl(url, {
                    method,
                    headers: {
                        ...config.requestHeaders,
                        ...step.headers,
                        ...(step.body === undefined
                            ? {}
                            : { 'content-type': 'application/json' }),
                        ...(step.instance
                            ? { 'x-or3-canary-instance': step.instance }
                            : {}),
                    },
                    body:
                        step.body === undefined
                            ? undefined
                            : JSON.stringify(step.body),
                    signal: AbortSignal.timeout(step.timeoutMs ?? 15_000),
                });
                const expectedStatus = step.expect?.status ?? 200;
                if (response.status !== expectedStatus) {
                    throw new Error(
                        `expected HTTP ${expectedStatus}, received ${response.status}`
                    );
                }
                if (step.expect?.json) {
                    const payload = await response.json();
                    for (const [path, expected] of Object.entries(
                        step.expect.json
                    )) {
                        const actual = readPath(payload, path);
                        if (!sameJsonValue(actual, expected)) {
                            throw new Error(
                                `expected ${path}=${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
                            );
                        }
                    }
                }
                steps.push({
                    id: step.id,
                    scenario,
                    instance: step.instance,
                    method,
                    url,
                    status: 'passed',
                    httpStatus: response.status,
                    durationMs: Math.round(performance.now() - stepStarted),
                });
            } catch (error) {
                steps.push({
                    id: step.id,
                    scenario,
                    instance: step.instance,
                    method,
                    url,
                    status: 'failed',
                    durationMs: Math.round(performance.now() - stepStarted),
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    const failed = steps.filter((step) => step.status === 'failed').length;
    const finishedAt = now().toISOString();
    const unsigned = {
        schemaVersion: CANARY_SCHEMA_VERSION,
        status:
            failed === 0 && topologyErrors.length === 0 ? 'passed' : 'failed',
        startedAt,
        finishedAt,
        artifact: config.artifact,
        topology: config.topology,
        topologyErrors,
        steps,
    } as const;
    const evidenceSha256 = createHash('sha256')
        .update(JSON.stringify(unsigned))
        .digest('hex');

    return {
        ...unsigned,
        summary: {
            passed: steps.length - failed,
            failed,
            evidenceSha256,
        },
    };
}
