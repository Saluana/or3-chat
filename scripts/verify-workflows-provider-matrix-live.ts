import {
    OpenRouterExecutionAdapter,
    type ChatMessage,
    type ExecutionCallbacks,
    type ModelCallResult,
    type ModelToolDescriptor,
    type WorkflowData,
} from 'or3-workflow-core';
import { createWorkflowModelGateway } from '../shared/openrouter/gateway';

const MODELS = [
    {
        id: 'openai/gpt-5.6-luna',
        vendor: 'openai',
        reasoningEffort: 'low' as const,
        expectsTemperature: false,
        expectsMandatoryReasoning: false,
    },
    {
        id: 'google/gemini-3.5-flash-lite',
        vendor: 'google',
        reasoningEffort: 'minimal' as const,
        expectsTemperature: true,
        expectsMandatoryReasoning: true,
    },
    {
        id: 'anthropic/claude-sonnet-5',
        vendor: 'anthropic',
        reasoningEffort: 'low' as const,
        expectsTemperature: false,
        expectsMandatoryReasoning: false,
    },
] as const;

const AUTH_URL = 'https://openrouter.ai/api/v1/key';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TEST_BUDGET_USD = 1.5;
const MAX_OUTPUT_TOKENS = 512;
const EXPECTED_PAID_CALLS = MODELS.length * 4 + 1;

interface CatalogModel {
    id: string;
    canonical_slug?: string;
    pricing?: {
        prompt?: string;
        completion?: string;
        internal_reasoning?: string;
    };
    supported_parameters?: string[];
    reasoning?: {
        mandatory?: boolean;
        supported_efforts?: string[];
    };
}

interface KeyMetadata {
    usage?: number;
    limitRemaining?: number;
}

interface ModelVerification {
    requestedModel: string;
    canonicalSlug?: string;
    providerResults: Array<{
        phase: 'structured' | 'tool-call' | 'tool-result' | 'router';
        actualModel?: string;
        provider?: string;
        finishReason?: string;
        costUsd?: number;
        totalMs?: number;
        requestId?: string;
    }>;
    structuredValue: {
        ok: true;
        vendor: string;
        answer: 42;
    };
    toolCallId: string;
    toolResult: string;
    routerExecutionOrder: string[];
    streamedCharacters: number;
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

function getCatalogModel(
    catalog: CatalogModel[],
    modelId: string
): CatalogModel {
    const model = catalog.find((candidate) => candidate.id === modelId);
    if (!model) {
        throw new Error(`Required matrix model "${modelId}" is unavailable.`);
    }
    return model;
}

function assertCatalogContract(
    catalogModel: CatalogModel,
    expectation: (typeof MODELS)[number]
): void {
    const supported = new Set(catalogModel.supported_parameters ?? []);
    for (const parameter of [
        'max_tokens',
        'reasoning',
        'response_format',
        'structured_outputs',
        'tool_choice',
        'tools',
    ]) {
        if (!supported.has(parameter)) {
            throw new Error(
                `${catalogModel.id} no longer advertises required parameter "${parameter}".`
            );
        }
    }
    if (supported.has('temperature') !== expectation.expectsTemperature) {
        throw new Error(
            `${catalogModel.id} temperature support changed; review request shaping before running paid calls.`
        );
    }
    if (
        Boolean(catalogModel.reasoning?.mandatory) !==
        expectation.expectsMandatoryReasoning
    ) {
        throw new Error(
            `${catalogModel.id} mandatory reasoning metadata changed; review its test profile.`
        );
    }
    if (
        !catalogModel.reasoning?.supported_efforts?.includes(
            expectation.reasoningEffort
        )
    ) {
        throw new Error(
            `${catalogModel.id} does not advertise reasoning effort "${expectation.reasoningEffort}".`
        );
    }
}

function price(model: CatalogModel, field: 'prompt' | 'completion'): number {
    return Number(model.pricing?.[field] ?? Number.NaN);
}

function assertWorstCaseBudget(catalogModels: CatalogModel[]): void {
    const promptPrice = Math.max(
        ...catalogModels.map((model) => price(model, 'prompt'))
    );
    const completionPrice = Math.max(
        ...catalogModels.map((model) => price(model, 'completion'))
    );
    if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice)) {
        throw new Error('Selected models are missing usable pricing metadata.');
    }

    // Prompts are intentionally tiny. These allowances remain conservative
    // enough to include hidden reasoning while preventing accidental spend.
    const worstCase =
        EXPECTED_PAID_CALLS *
        (4_000 * promptPrice + MAX_OUTPUT_TOKENS * completionPrice);
    if (worstCase > TEST_BUDGET_USD) {
        throw new Error(
            `Worst-case provider matrix cost $${worstCase.toFixed(4)} exceeds the $${TEST_BUDGET_USD.toFixed(2)} budget.`
        );
    }
}

function record(
    phase: ModelVerification['providerResults'][number]['phase'],
    result: ModelCallResult
): ModelVerification['providerResults'][number] {
    return {
        phase,
        actualModel: result.actualModel,
        provider: result.provider,
        finishReason: result.finishReason,
        costUsd: result.usage?.costUsd,
        totalMs: result.timing?.totalMs,
        requestId:
            result.identifiers?.requestId ??
            result.identifiers?.generationId ??
            result.identifiers?.upstreamId,
    };
}

function parseStructuredValue(
    content: string | null,
    vendor: string
): ModelVerification['structuredValue'] {
    if (!content) throw new Error(`${vendor} returned empty structured output.`);
    const value = JSON.parse(content) as {
        ok?: unknown;
        vendor?: unknown;
        answer?: unknown;
    };
    if (
        value.ok !== true ||
        value.vendor !== vendor ||
        value.answer !== 42
    ) {
        throw new Error(
            `${vendor} returned unexpected structured output: ${content}`
        );
    }
    return value as ModelVerification['structuredValue'];
}

const callbacks: ExecutionCallbacks = {
    onNodeStart: () => undefined,
    onNodeFinish: () => undefined,
    onNodeError: () => undefined,
    onToken: () => undefined,
};

const lookupTool: ModelToolDescriptor = {
    type: 'function',
    function: {
        name: 'lookup_or3_answer',
        description: 'Return the deterministic OR3 compatibility-test answer.',
        parameters: {
            type: 'object',
            properties: {
                key: { type: 'string', enum: ['answer'] },
            },
            required: ['key'],
            additionalProperties: false,
        },
    },
};

async function verifyModel(
    apiKey: string,
    catalogModel: CatalogModel,
    expectation: (typeof MODELS)[number]
): Promise<ModelVerification> {
    const warnings: string[] = [];
    const gateway = createWorkflowModelGateway({
        apiKey,
        metadata: 'enabled',
        onWarning: (warning) => warnings.push(warning),
    });
    const providerResults: ModelVerification['providerResults'] = [];
    let streamedCharacters = 0;
    const structuredSchema = {
        type: 'object',
        properties: {
            ok: { type: 'boolean', const: true },
            vendor: { type: 'string', const: expectation.vendor },
            answer: { type: 'integer', const: 42 },
        },
        required: ['ok', 'vendor', 'answer'],
        additionalProperties: false,
    };

    const structured = await gateway.generate({
        models: [expectation.id],
        messages: [
            {
                role: 'user',
                content: `Return strict JSON with ok=true, vendor="${expectation.vendor}", and answer=42.`,
            },
        ],
        generation: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            reasoning: {
                enabled: true,
                effort: expectation.reasoningEffort,
            },
            responseFormat: {
                name: `or3_${expectation.vendor}_compatibility`,
                schema: structuredSchema,
                strict: true,
            },
        },
        routing: { requireParameters: true },
        onTextDelta: (delta) => {
            streamedCharacters += delta.length;
        },
        signal: AbortSignal.timeout(90_000),
    });
    providerResults.push(record('structured', structured));
    const structuredValue = parseStructuredValue(
        structured.content,
        expectation.vendor
    );
    if (streamedCharacters === 0) {
        throw new Error(`${expectation.id} did not exercise streaming output.`);
    }

    const toolPrompt: ChatMessage = {
        role: 'user',
        content:
            'Call lookup_or3_answer with key="answer". Do not answer without calling the tool.',
    };
    const toolCall = await gateway.generate({
        models: [expectation.id],
        messages: [toolPrompt],
        generation: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            reasoning: {
                enabled: true,
                effort: expectation.reasoningEffort,
            },
        },
        routing: { requireParameters: true },
        tools: [lookupTool],
        toolChoice: {
            type: 'function',
            function: { name: 'lookup_or3_answer' },
        },
        onTextDelta: () => undefined,
        onReasoningDelta: () => undefined,
        signal: AbortSignal.timeout(90_000),
    });
    providerResults.push(record('tool-call', toolCall));
    const selectedTool = toolCall.toolCalls?.[0];
    if (
        !selectedTool ||
        selectedTool.function.name !== 'lookup_or3_answer' ||
        JSON.parse(selectedTool.function.arguments).key !== 'answer'
    ) {
        throw new Error(
            `${expectation.id} returned an invalid forced tool call: ${JSON.stringify(toolCall.toolCalls)}`
        );
    }
    if (!selectedTool.id) {
        throw new Error(`${expectation.id} returned a tool call without an id.`);
    }

    const toolResult = await gateway.generate({
        models: [expectation.id],
        messages: [
            toolPrompt,
            toolCall.assistantMessage,
            {
                role: 'tool',
                content: '{"answer":42}',
                tool_call_id: selectedTool.id,
                name: selectedTool.function.name,
            },
        ],
        generation: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            reasoning: {
                enabled: true,
                effort: expectation.reasoningEffort,
            },
        },
        routing: { requireParameters: true },
        tools: [lookupTool],
        toolChoice: 'none',
        onTextDelta: () => undefined,
        onReasoningDelta: () => undefined,
        signal: AbortSignal.timeout(90_000),
    });
    providerResults.push(record('tool-result', toolResult));
    if (!toolResult.content?.includes('42')) {
        throw new Error(
            `${expectation.id} did not consume the tool result: ${toolResult.content}`
        );
    }

    const routerWorkflow: WorkflowData = {
        meta: {
            id: `provider-matrix-router-${expectation.vendor}`,
            version: '2.0.0',
            name: `${expectation.vendor} router compatibility`,
            execution: {
                stopPolicy: { maxSteps: 1, maxCostUsd: 0.15 },
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
                id: 'router',
                type: 'router',
                position: { x: 200, y: 0 },
                data: {
                    label: `${expectation.vendor} router`,
                    model: expectation.id,
                    modelRequest: {
                        version: 1,
                        models: [expectation.id],
                        generation: {
                            maxOutputTokens: MAX_OUTPUT_TOKENS,
                            reasoning: {
                                enabled: true,
                                effort: expectation.reasoningEffort,
                            },
                        },
                        routing: { requireParameters: true },
                    },
                    prompt:
                        'Select route "one" when exactly one implementation is requested.',
                    routes: [
                        { id: 'one', label: 'One implementation' },
                        { id: 'many', label: 'Many implementations' },
                    ],
                },
            },
            {
                id: 'one',
                type: 'output',
                position: { x: 420, y: -80 },
                data: {
                    label: 'One implementation',
                    format: 'text',
                    mode: 'raw',
                },
            },
            {
                id: 'many',
                type: 'output',
                position: { x: 420, y: 80 },
                data: {
                    label: 'Many implementations',
                    format: 'text',
                    mode: 'raw',
                },
            },
        ],
        edges: [
            { id: 'start-router', source: 'start', target: 'router' },
            {
                id: 'router-one',
                source: 'router',
                sourceHandle: 'one',
                target: 'one',
            },
            {
                id: 'router-many',
                source: 'router',
                sourceHandle: 'many',
                target: 'many',
            },
        ],
    };
    const adapter = new OpenRouterExecutionAdapter(gateway, {
        defaultModel: expectation.id,
        preflight: true,
    });
    const routerResult = await adapter.execute(
        routerWorkflow,
        { text: 'Create exactly one Three.js snake implementation.' },
        callbacks
    );
    if (!routerResult.success) {
        throw (
            routerResult.error ??
            new Error(`${expectation.id} router workflow failed.`)
        );
    }
    if (!routerResult.executionOrder.includes('one')) {
        throw new Error(
            `${expectation.id} selected the wrong route: ${routerResult.executionOrder.join(', ')}`
        );
    }
    const routerCall = routerResult.modelCalls?.[0];
    if (!routerCall) {
        throw new Error(`${expectation.id} router call was not recorded.`);
    }
    providerResults.push({
        phase: 'router',
        actualModel: routerCall.actualModel,
        provider: routerCall.provider,
        finishReason: routerCall.finishReason,
        costUsd: routerCall.usage?.costUsd,
        totalMs: routerCall.timing?.totalMs,
        requestId:
            routerCall.identifiers?.requestId ??
            routerCall.identifiers?.generationId ??
            routerCall.identifiers?.upstreamId,
    });

    if (warnings.length > 0) {
        throw new Error(
            `${expectation.id} emitted compatibility warnings: ${warnings.join(' | ')}`
        );
    }
    for (const result of providerResults) {
        if (result.actualModel !== expectation.id) {
            throw new Error(
                `${expectation.id} ${result.phase} resolved unexpected model "${result.actualModel}".`
            );
        }
        if (!result.provider) {
            throw new Error(
                `${expectation.id} ${result.phase} did not report the actual provider.`
            );
        }
    }

    return {
        requestedModel: expectation.id,
        canonicalSlug: catalogModel.canonical_slug,
        providerResults,
        structuredValue,
        toolCallId: selectedTool.id,
        toolResult: toolResult.content,
        routerExecutionOrder: routerResult.executionOrder,
        streamedCharacters,
    };
}

async function verifyForcedFallback(apiKey: string): Promise<{
    requestedModels: [string, string];
    actualModel?: string;
    provider?: string;
    content: string | null;
    costUsd?: number;
}> {
    const gateway = createWorkflowModelGateway({
        apiKey,
        metadata: 'enabled',
    });
    const requestedModels: [string, string] = [
        'openai/gpt-5.6-luna',
        'google/gemini-3.5-flash-lite',
    ];
    const result = await gateway.generate({
        models: requestedModels,
        messages: [
            {
                role: 'user',
                content: 'Reply with exactly OR3_FALLBACK_OK.',
            },
        ],
        generation: {
            // Luna does not advertise temperature. Gemini does. With strict
            // parameter routing this deterministically exercises model fallback.
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        routing: { requireParameters: true },
        onTextDelta: () => undefined,
        signal: AbortSignal.timeout(90_000),
    });
    if (result.actualModel !== requestedModels[1]) {
        throw new Error(
            `Expected forced fallback to ${requestedModels[1]}, got ${result.actualModel}.`
        );
    }
    if (!result.content?.includes('OR3_FALLBACK_OK')) {
        throw new Error(`Unexpected fallback output: ${result.content}`);
    }
    return {
        requestedModels,
        actualModel: result.actualModel,
        provider: result.provider,
        content: result.content,
        costUsd: result.usage?.costUsd,
    };
}

async function main(): Promise<void> {
    requireLiveOptIn();
    const apiKey = requireApiKey();
    const catalog = await getCatalog();
    const catalogModels = MODELS.map((expectation) => {
        const model = getCatalogModel(catalog, expectation.id);
        assertCatalogContract(model, expectation);
        return model;
    });
    assertWorstCaseBudget(catalogModels);

    const before = await getKeyMetadata(apiKey);
    if (
        before.limitRemaining !== undefined &&
        before.limitRemaining < TEST_BUDGET_USD
    ) {
        throw new Error(
            `OpenRouter key has only $${before.limitRemaining.toFixed(4)} remaining; refusing the $${TEST_BUDGET_USD.toFixed(2)} matrix.`
        );
    }

    const results: ModelVerification[] = [];
    for (let index = 0; index < MODELS.length; index++) {
        results.push(
            await verifyModel(apiKey, catalogModels[index]!, MODELS[index]!)
        );
    }
    const forcedFallback = await verifyForcedFallback(apiKey);
    const reportedSpendUsd =
        results.reduce(
            (total, result) =>
                total +
                result.providerResults.reduce(
                    (subtotal, call) => subtotal + (call.costUsd ?? 0),
                    0
                ),
            0
        ) + (forcedFallback.costUsd ?? 0);
    if (reportedSpendUsd > TEST_BUDGET_USD) {
        throw new Error(
            `Provider-reported matrix cost $${reportedSpendUsd.toFixed(4)} exceeds the $${TEST_BUDGET_USD.toFixed(2)} budget.`
        );
    }

    const after = await getKeyMetadata(apiKey);
    const measuredSpendUsd =
        before.usage !== undefined && after.usage !== undefined
            ? Math.max(0, after.usage - before.usage)
            : undefined;
    if (
        measuredSpendUsd !== undefined &&
        measuredSpendUsd > TEST_BUDGET_USD
    ) {
        throw new Error(
            `Provider matrix spent $${measuredSpendUsd.toFixed(4)}, exceeding the $${TEST_BUDGET_USD.toFixed(2)} budget.`
        );
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                expectedPaidCalls: EXPECTED_PAID_CALLS,
                results,
                forcedFallback,
                reportedSpendUsd,
                measuredSpendUsd,
            },
            null,
            2
        )
    );
}

await main();
