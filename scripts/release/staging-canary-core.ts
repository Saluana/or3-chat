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
    | 'rollingRestart';

export type StagingCanaryConfig = {
    baseUrl: string;
    artifact: {
        candidate: string;
        previous: string;
        providerDataSnapshot: string;
    };
    topology: ProviderTopology;
    requestHeaders?: Record<string, string>;
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
    ] as const) {
        if (!config.scenarios?.[name]?.length) {
            throw new Error(`scenarios.${name} must contain at least one step`);
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
    }
    const steps: CanaryStepEvidence[] = [];
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
        ...Object.entries(config.scenarios) as Array<
            [CanaryScenarioName, CanaryHttpStep[]]
        >,
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
