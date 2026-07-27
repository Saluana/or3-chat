import {
    InMemoryRunStore,
    isSafeForExport,
    OpenRouterExecutionAdapter,
    type ExecutionCallbacks,
    type WorkflowData,
    type WorkflowEventEnvelope,
} from 'or3-workflow-core';
import { createWorkflowModelGateway } from '../shared/openrouter/gateway';

const PRIMARY_MODEL = 'x-ai/grok-4.5';
const AUTH_URL = 'https://openrouter.ai/api/v1/key';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TEST_BUDGET_USD = 1.5;
const RUNTIME_COST_LIMIT_USD = 1.25;
const EXPECTED_MODEL_CALLS = 4;
const MAX_OUTPUT_TOKENS = 2_048;

interface CatalogModel {
    id: string;
    pricing?: { prompt?: string; completion?: string };
    supported_parameters?: string[];
}

interface KeyMetadata {
    usage?: number;
    limitRemaining?: number;
}

function requireLiveOptIn(): void {
    if (process.env.OR3_LIVE_OPENROUTER !== '1') {
        throw new Error(
            'Live verification is disabled. Re-run with OR3_LIVE_OPENROUTER=1.'
        );
    }
}

function requireApiKey(): string {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is not configured.');
    return key;
}

async function getKeyMetadata(apiKey: string): Promise<KeyMetadata> {
    const response = await fetch(AUTH_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(
            `OpenRouter key metadata request failed (${response.status}).`
        );
    }
    const body = (await response.json()) as {
        data?: {
            usage?: number | null;
            limit_remaining?: number | null;
        };
    };
    return {
        usage:
            typeof body.data?.usage === 'number'
                ? body.data.usage
                : undefined,
        limitRemaining:
            typeof body.data?.limit_remaining === 'number'
                ? body.data.limit_remaining
                : undefined,
    };
}

async function getCatalog(): Promise<CatalogModel[]> {
    const response = await fetch(MODELS_URL, {
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(
            `OpenRouter model catalog request failed (${response.status}).`
        );
    }
    const body = (await response.json()) as { data?: CatalogModel[] };
    return body.data ?? [];
}

function price(model: CatalogModel, key: 'prompt' | 'completion'): number {
    return Number(model.pricing?.[key] ?? Number.NaN);
}

function chooseFallback(catalog: CatalogModel[]): CatalogModel {
    const candidates = catalog.filter(
        (model) =>
            model.id !== PRIMARY_MODEL &&
            model.supported_parameters?.includes('structured_outputs') &&
            Number.isFinite(price(model, 'prompt')) &&
            Number.isFinite(price(model, 'completion'))
    );
    candidates.sort(
        (left, right) =>
            price(left, 'prompt') +
            price(left, 'completion') -
            price(right, 'prompt') -
            price(right, 'completion')
    );
    const preferred = [
        'google/gemini-2.5-flash-lite',
        'openai/gpt-5-mini',
    ]
        .map((id) => candidates.find((model) => model.id === id))
        .find(Boolean);
    const fallback = preferred ?? candidates[0];
    if (!fallback) {
        throw new Error(
            'No structured-output-capable fallback model was found.'
        );
    }
    return fallback;
}

function assertWorstCaseBudget(
    primary: CatalogModel,
    fallback: CatalogModel
): void {
    for (const model of [primary, fallback]) {
        if (
            !Number.isFinite(price(model, 'prompt')) ||
            !Number.isFinite(price(model, 'completion'))
        ) {
            throw new Error(`Missing pricing metadata for ${model.id}.`);
        }
    }
    const mostExpensivePrompt = Math.max(
        price(primary, 'prompt'),
        price(fallback, 'prompt')
    );
    const mostExpensiveCompletion = Math.max(
        price(primary, 'completion'),
        price(fallback, 'completion')
    );
    // Four calls: two parallel specialists, their merge, then strict schema
    // normalization. Input allowance is intentionally much larger than actual.
    const worstCase =
        EXPECTED_MODEL_CALLS *
        (8_000 * mostExpensivePrompt +
            MAX_OUTPUT_TOKENS * mostExpensiveCompletion);
    if (worstCase > TEST_BUDGET_USD) {
        throw new Error(
            `Worst-case complex verification cost $${worstCase.toFixed(4)} exceeds the $${TEST_BUDGET_USD.toFixed(2)} budget.`
        );
    }
}

const callbacks: ExecutionCallbacks = {
    onNodeStart: () => undefined,
    onNodeFinish: () => undefined,
    onNodeError: () => undefined,
    onToken: () => undefined,
};

async function main(): Promise<void> {
    requireLiveOptIn();
    const apiKey = requireApiKey();
    const catalog = await getCatalog();
    const primary = catalog.find(
        (model) => model.id === PRIMARY_MODEL
    );
    if (!primary) {
        throw new Error(`Requested model "${PRIMARY_MODEL}" is unavailable.`);
    }
    const fallback = chooseFallback(catalog);
    assertWorstCaseBudget(primary, fallback);

    const before = await getKeyMetadata(apiKey);
    if (
        before.limitRemaining !== undefined &&
        before.limitRemaining < TEST_BUDGET_USD
    ) {
        throw new Error(
            `OpenRouter key has only $${before.limitRemaining.toFixed(4)} remaining; refusing the live test.`
        );
    }

    const warnings: string[] = [];
    const events: WorkflowEventEnvelope[] = [];
    const gateway = createWorkflowModelGateway({
        apiKey,
        metadata: 'enabled',
        onWarning: (warning) => warnings.push(warning),
    });
    const models = [PRIMARY_MODEL, fallback.id] as [
        string,
        ...string[],
    ];
    const modelRequest = {
        version: 1 as const,
        models,
        routing: {
            requireParameters: true,
            preferredMaxLatency: { p90: 30 },
            // Grok 4.5 currently lists above $12/M output, so keep this
            // provider ceiling high enough to exercise the requested primary.
            maxPrice: { prompt: 5, completion: 20 },
        },
        generation: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            reasoning: { enabled: true, effort: 'low' as const },
        },
    };
    const schema = {
        type: 'object',
        properties: {
            ok: { type: 'boolean', const: true },
            answer: { type: 'integer', const: 42 },
            evidence: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
            },
        },
        required: ['ok', 'answer', 'evidence'],
        additionalProperties: false,
    };
    const workflow: WorkflowData = {
        meta: {
            id: 'live-complex-openrouter-verification',
            version: '2.0.0',
            name: 'Complex live OpenRouter verification',
            execution: {
                stopPolicy: {
                    maxSteps: 6,
                    maxCostUsd: RUNTIME_COST_LIMIT_USD,
                    maxDurationMs: 180_000,
                },
            },
        },
        nodes: [
            {
                id: 'start',
                type: 'start',
                position: { x: 0, y: 0 },
                data: { label: 'Start' },
            },
            {
                id: 'parallel',
                type: 'parallel',
                position: { x: 220, y: 0 },
                data: {
                    label: 'Independent checks',
                    model: PRIMARY_MODEL,
                    modelRequest,
                    prompt:
                        'Merge the two checks into one concise evidence report. Preserve both numeric equations and the answer 42.',
                    mergeEnabled: true,
                    branchTimeout: 90_000,
                    branches: [
                        {
                            id: 'addition',
                            label: 'Addition specialist',
                            modelRequest,
                            prompt:
                                'Compute 17 + 25. Respond concisely and include the exact equation and result.',
                            permissions: [],
                        },
                        {
                            id: 'multiplication',
                            label: 'Multiplication verifier',
                            modelRequest,
                            prompt:
                                'Independently compute 6 * 7. Respond concisely and include the exact equation and result.',
                            permissions: [],
                        },
                    ],
                },
            },
            {
                id: 'structured',
                type: 'agent',
                position: { x: 500, y: 0 },
                data: {
                    label: 'Strict result normalizer',
                    model: PRIMARY_MODEL,
                    modelRequest,
                    prompt:
                        'Convert the supplied evidence into the requested strict JSON. Set ok=true, answer=42, and include at least two evidence strings. Return no prose.',
                    maxTokens: MAX_OUTPUT_TOKENS,
                    permissions: [],
                    structuredOutput: {
                        name: 'complex_live_result',
                        schemaId: 'complex_live_result',
                        schemaVersion: 1,
                        schema,
                        strict: true,
                        repair: {
                            maxAttempts: 1,
                            backend: 'response-healing',
                        },
                    },
                },
            },
        ],
        edges: [
            {
                id: 'start-parallel',
                source: 'start',
                target: 'parallel',
            },
            {
                id: 'parallel-structured',
                source: 'parallel',
                sourceHandle: 'merged',
                target: 'structured',
            },
        ],
    };

    const runStore = new InMemoryRunStore();
    const runId = `live-complex-${Date.now()}`;
    const adapter = new OpenRouterExecutionAdapter(gateway, {
        defaultModel: PRIMARY_MODEL,
        preflight: true,
        runStore,
        runId,
        onEventV2: (event) => events.push(event),
    });
    const result = await adapter.execute(
        workflow,
        {
            text:
                'Perform both independent arithmetic checks, merge their evidence, and return the strict result.',
        },
        callbacks
    );
    if (!result.success) {
        throw result.error ?? new Error('Complex workflow failed.');
    }
    const value = JSON.parse(result.output) as {
        ok?: unknown;
        answer?: unknown;
        evidence?: unknown;
    };
    if (
        value.ok !== true ||
        value.answer !== 42 ||
        !Array.isArray(value.evidence) ||
        value.evidence.length < 2
    ) {
        throw new Error(`Unexpected workflow output: ${result.output}`);
    }
    if ((result.modelCalls?.length ?? 0) < EXPECTED_MODEL_CALLS) {
        throw new Error(
            `Expected at least ${EXPECTED_MODEL_CALLS} model calls; recorded ${result.modelCalls?.length ?? 0}.`
        );
    }
    if (
        result.costUsd !== undefined &&
        result.costUsd > RUNTIME_COST_LIMIT_USD
    ) {
        throw new Error(
            `Runtime reported $${result.costUsd.toFixed(4)}, above its configured limit.`
        );
    }
    const snapshot = (await runStore.load(runId)).snapshot;
    if (snapshot?.status !== 'completed') {
        throw new Error('Durable run snapshot was not completed.');
    }
    for (let index = 1; index < events.length; index++) {
        if (events[index]!.sequence !== events[index - 1]!.sequence + 1) {
            throw new Error('V2 event sequence is not monotonic.');
        }
    }
    const sensitiveFinish = events.find(
        (event) =>
            event.event.type === 'node_finish' &&
            event.event.nodeId === 'structured'
    );
    if (
        sensitiveFinish?.event.type !== 'node_finish' ||
        sensitiveFinish.event.output !== '[redacted]'
    ) {
        throw new Error('Default V2 event redaction was not applied.');
    }
    if (!events.every((event) => isSafeForExport(event))) {
        throw new Error(
            'At least one V2 event failed the default export-safety check.'
        );
    }
    const done = events.find(
        (event) => event.event.type === 'done'
    );
    if (
        done?.event.type !== 'done' ||
        done.event.result.output !== '[redacted]' ||
        done.event.result.sessionMessages !== undefined
    ) {
        throw new Error(
            'The V2 completion envelope leaked workflow content.'
        );
    }

    const after = await getKeyMetadata(apiKey);
    const measuredSpend =
        before.usage !== undefined && after.usage !== undefined
            ? Math.max(0, after.usage - before.usage)
            : undefined;
    if (measuredSpend !== undefined && measuredSpend > TEST_BUDGET_USD) {
        throw new Error(
            `Complex verification spent $${measuredSpend.toFixed(4)}, exceeding the budget.`
        );
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                requestedModels: models,
                actualCalls: result.modelCalls?.map((call) => ({
                    nodeId: call.nodeId,
                    actualModel: call.actualModel,
                    provider: call.provider,
                    costUsd: call.usage?.costUsd,
                    totalMs: call.timing?.totalMs,
                })),
                executionOrder: result.executionOrder,
                output: value,
                costUsd: result.costUsd,
                measuredSpendUsd: measuredSpend,
                v2EventCount: events.length,
                durableStatus: snapshot.status,
                warnings,
            },
            null,
            2
        )
    );
}

await main();
