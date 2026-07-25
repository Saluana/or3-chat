import {
    OpenRouterExecutionAdapter,
    type ExecutionCallbacks,
    type WorkflowData,
} from 'or3-workflow-core';
import { createWorkflowModelGateway } from '../shared/openrouter/gateway';

const MODEL = 'x-ai/grok-4.5';
const AUTH_URL = 'https://openrouter.ai/api/v1/key';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TEST_BUDGET_USD = 1.5;
// Grok 4.5 has mandatory reasoning. Leave enough room for its hidden reasoning
// plus the tiny final JSON while remaining far below the test budget.
const MAX_OUTPUT_TOKENS_PER_CALL = 2_048;

interface KeyMetadata {
    usage?: number;
    limitRemaining?: number;
}

interface CatalogModel {
    id: string;
    pricing?: {
        prompt?: string;
        completion?: string;
    };
    supported_parameters?: string[];
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
    if (!key) {
        throw new Error('OPENROUTER_API_KEY is not configured.');
    }
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

async function getCatalogModel(): Promise<CatalogModel> {
    const response = await fetch(MODELS_URL, {
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(
            `OpenRouter model catalog request failed (${response.status}).`
        );
    }
    const body = (await response.json()) as { data?: CatalogModel[] };
    const model = body.data?.find((candidate) => candidate.id === MODEL);
    if (!model) {
        throw new Error(`Requested live-test model "${MODEL}" is unavailable.`);
    }
    return model;
}

function assertWorstCaseBudget(model: CatalogModel): void {
    const promptPerToken = Number(model.pricing?.prompt ?? Number.NaN);
    const completionPerToken = Number(
        model.pricing?.completion ?? Number.NaN
    );
    if (
        !Number.isFinite(promptPerToken) ||
        !Number.isFinite(completionPerToken)
    ) {
        throw new Error(`No usable pricing metadata was reported for ${MODEL}.`);
    }

    // Two deliberately tiny calls. Use a conservative 4,000 input tokens per
    // request, even though the prompts are far smaller.
    const worstCase =
        2 *
        (4_000 * promptPerToken +
            MAX_OUTPUT_TOKENS_PER_CALL * completionPerToken);
    if (worstCase > TEST_BUDGET_USD) {
        throw new Error(
            `Worst-case live verification cost $${worstCase.toFixed(4)} exceeds the $${TEST_BUDGET_USD.toFixed(2)} budget.`
        );
    }
}

function parseExpectedJson(content: string | null): {
    ok: true;
    source: 'or3-live';
} {
    if (!content) throw new Error('OpenRouter returned empty structured output.');
    const value = JSON.parse(content) as { ok?: unknown; source?: unknown };
    if (value.ok !== true || value.source !== 'or3-live') {
        throw new Error(`Unexpected structured output: ${content}`);
    }
    return value as { ok: true; source: 'or3-live' };
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
    const model = await getCatalogModel();
    assertWorstCaseBudget(model);

    const before = await getKeyMetadata(apiKey);
    if (
        before.limitRemaining !== undefined &&
        before.limitRemaining < TEST_BUDGET_USD
    ) {
        throw new Error(
            `OpenRouter key has only $${before.limitRemaining.toFixed(4)} remaining; refusing a $${TEST_BUDGET_USD.toFixed(2)}-budget test.`
        );
    }

    const warnings: string[] = [];
    const gateway = createWorkflowModelGateway({
        apiKey,
        metadata: 'enabled',
        onWarning: (warning) => warnings.push(warning),
    });
    const schema = {
        type: 'object',
        properties: {
            ok: { type: 'boolean', const: true },
            source: { type: 'string', const: 'or3-live' },
        },
        required: ['ok', 'source'],
        additionalProperties: false,
    };

    const direct = await gateway.generate({
        models: [MODEL],
        messages: [
            {
                role: 'user',
                content:
                    'Return JSON with ok=true and source="or3-live". No other fields.',
            },
        ],
        generation: {
            maxOutputTokens: MAX_OUTPUT_TOKENS_PER_CALL,
            reasoning: { enabled: true, effort: 'low' },
            responseFormat: {
                name: 'or3_live_verification',
                schema,
                strict: true,
            },
        },
        routing: {
            requireParameters: true,
            maxPrice: { prompt: 2.1, completion: 6.1 },
            preferredMaxLatency: { p90: 30 },
        },
        signal: AbortSignal.timeout(60_000),
    });
    const directValue = parseExpectedJson(direct.content);

    const reportedFirstCost = direct.usage?.costUsd ?? 0;
    if (reportedFirstCost >= TEST_BUDGET_USD / 2) {
        throw new Error(
            `First call reported $${reportedFirstCost.toFixed(4)}; refusing the second call to preserve budget.`
        );
    }

    const workflow: WorkflowData = {
        meta: {
            id: 'live-openrouter-verification',
            version: '2.0.0',
            name: 'Live OpenRouter verification',
        },
        nodes: [
            {
                id: 'start',
                type: 'start',
                position: { x: 0, y: 0 },
                data: { label: 'Start' },
            },
            {
                id: 'agent',
                type: 'agent',
                position: { x: 200, y: 0 },
                data: {
                    label: 'Structured live agent',
                    model: MODEL,
                    prompt:
                        'Return only the requested JSON object. Do not add prose.',
                    maxTokens: MAX_OUTPUT_TOKENS_PER_CALL,
                    structuredOutput: {
                        name: 'or3_live_verification',
                        schema,
                        strict: true,
                    },
                },
            },
        ],
        edges: [
            {
                id: 'start-agent',
                source: 'start',
                target: 'agent',
            },
        ],
    };

    const adapter = new OpenRouterExecutionAdapter(gateway, {
        defaultModel: MODEL,
        preflight: true,
    });
    const workflowResult = await adapter.execute(
        workflow,
        { text: 'Set ok=true and source="or3-live".' },
        callbacks
    );
    if (!workflowResult.success) {
        throw workflowResult.error ?? new Error('Workflow execution failed.');
    }
    const workflowValue = parseExpectedJson(workflowResult.output);

    const after = await getKeyMetadata(apiKey);
    const measuredSpend =
        before.usage !== undefined && after.usage !== undefined
            ? Math.max(0, after.usage - before.usage)
            : undefined;
    if (measuredSpend !== undefined && measuredSpend > TEST_BUDGET_USD) {
        throw new Error(
            `Live verification spent $${measuredSpend.toFixed(4)}, exceeding the $${TEST_BUDGET_USD.toFixed(2)} budget.`
        );
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                modelRequested: MODEL,
                actualModel: direct.actualModel,
                provider: direct.provider,
                finishReason: direct.finishReason,
                usage: direct.usage,
                identifiers: direct.identifiers,
                timing: direct.timing,
                directValue,
                workflowValue,
                workflowExecutionOrder: workflowResult.executionOrder,
                workflowOutput: workflowResult.output,
                measuredSpendUsd: measuredSpend,
                warnings,
            },
            null,
            2
        )
    );
}

await main();
