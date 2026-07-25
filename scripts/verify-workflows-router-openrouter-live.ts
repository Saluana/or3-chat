import {
    OpenRouterExecutionAdapter,
    type ExecutionCallbacks,
    type WorkflowData,
} from 'or3-workflow-core';
import { createWorkflowModelGateway } from '../shared/openrouter/gateway';

const MODEL = 'openai/gpt-5.6-luna';
const MAX_COST_USD = 0.05;

if (process.env.OR3_LIVE_OPENROUTER !== '1') {
    throw new Error(
        'Live verification is disabled. Set OR3_LIVE_OPENROUTER=1.'
    );
}
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

const workflow: WorkflowData = {
    meta: {
        id: 'live-router-parameter-verification',
        version: '2.0.0',
        name: 'Router parameter compatibility',
        execution: { stopPolicy: { maxSteps: 1, maxCostUsd: MAX_COST_USD } },
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
                label: 'Subagent Spinner',
                model: MODEL,
                modelRequest: {
                    version: 1,
                    models: [MODEL],
                    routing: { requireParameters: true },
                },
                prompt:
                    'Choose "one" for a request that asks for one implementation.',
                routes: [
                    { id: 'one', label: 'One Request' },
                    { id: 'two', label: 'Two Requests' },
                ],
            },
        },
        {
            id: 'one',
            type: 'output',
            position: { x: 400, y: -80 },
            data: {
                label: 'One Request',
                description: 'A single implementation was requested.',
                format: 'text',
                mode: 'raw',
            },
        },
        {
            id: 'two',
            type: 'output',
            position: { x: 400, y: 80 },
            data: {
                label: 'Two Requests',
                description: 'Two independent implementations were requested.',
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
            id: 'router-two',
            source: 'router',
            sourceHandle: 'two',
            target: 'two',
        },
    ],
};

const callbacks: ExecutionCallbacks = {
    onNodeStart: () => undefined,
    onNodeFinish: () => undefined,
    onNodeError: () => undefined,
    onToken: () => undefined,
};
const gateway = createWorkflowModelGateway({ apiKey, metadata: 'enabled' });
const adapter = new OpenRouterExecutionAdapter(gateway, {
    defaultModel: MODEL,
    preflight: true,
});
const result = await adapter.execute(
    workflow,
    { text: 'Create one snake game implementation using Three.js.' },
    callbacks
);

if (!result.success) throw result.error ?? new Error('Router workflow failed.');
if (!result.executionOrder.includes('one')) {
    throw new Error(
        `Expected route "one"; execution order was ${result.executionOrder.join(', ')}.`
    );
}
if ((result.costUsd ?? 0) > MAX_COST_USD) {
    throw new Error(
        `Router canary cost $${result.costUsd} exceeded $${MAX_COST_USD}.`
    );
}

console.log(
    JSON.stringify(
        {
            ok: true,
            model: result.modelCalls?.[0]?.actualModel,
            provider: result.modelCalls?.[0]?.provider,
            route: 'one',
            executionOrder: result.executionOrder,
            costUsd: result.costUsd,
        },
        null,
        2
    )
);
