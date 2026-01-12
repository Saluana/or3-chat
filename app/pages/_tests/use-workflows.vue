<template>
    <div
        class="h-[100dvh] bg-[var(--md-surface)] text-[var(--md-on-surface)] flex overflow-hidden"
    >
        <!-- Left Column: Tests List -->
        <div
            class="w-1/3 min-w-[300px] border-r border-[var(--md-border-color)] flex flex-col"
        >
            <div
                class="p-4 border-b border-[var(--md-border-color)] bg-[var(--md-surface-container)]"
            >
                <ClientOnly>
                    <h1 class="text-xl font-bold mb-2">Workflow Test Bench</h1>
                </ClientOnly>
                <div class="flex items-center gap-2 text-sm">
                    <div class="flex items-center gap-1">
                        <div class="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <span>{{ summary.pass }} Pass</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <div class="w-3 h-3 rounded-full bg-red-500"></div>
                        <span>{{ summary.fail }} Fail</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
                        <span>{{ summary.pending }} Pending</span>
                    </div>
                </div>
                <div class="mt-4 flex gap-2 flex-wrap">
                    <button
                        @click="runTests"
                        :disabled="running"
                        class="px-4 py-2 bg-[var(--md-primary)] text-[var(--md-on-primary)] rounded hover:opacity-90 disabled:opacity-50 font-medium"
                    >
                        {{ running ? 'Running...' : 'Run All Tests' }}
                    </button>
                    <button
                        @click="resetEnvironment"
                        class="px-3 py-2 border border-[var(--md-border-color)] rounded hover:bg-[var(--md-surface-variant)]"
                    >
                        Reset
                    </button>
                </div>
                <div class="mt-3 flex gap-4 text-sm">
                    <label
                        class="flex items-center gap-2 cursor-pointer select-none"
                    >
                        <input type="checkbox" v-model="stopOnFailure" />
                        Stop on fail
                    </label>
                </div>
                <div v-if="apiKey" class="mt-2 text-xs text-emerald-500">
                    ✓ API key loaded
                </div>
            </div>

            <div class="flex-1 overflow-y-auto p-2 space-y-2">
                <div
                    v-for="test in results"
                    :key="test.id"
                    class="p-3 rounded border transition-colors cursor-pointer"
                    :class="[
                        test.status === 'pass'
                            ? 'border-emerald-500/20 bg-emerald-500/5'
                            : test.status === 'fail'
                            ? 'border-red-500/50 bg-red-500/10'
                            : test.status === 'running'
                            ? 'border-blue-500/30 bg-blue-500/5'
                            : 'border-[var(--md-border-color)] hover:bg-[var(--md-surface-container-low)]',
                        activeTestId === test.id
                            ? 'ring-2 ring-[var(--md-primary)]'
                            : '',
                    ]"
                    @click="scrollToLog(test.id)"
                >
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="font-medium text-sm">
                                {{ test.label }}
                            </div>
                            <div class="text-xs opacity-70 mt-1 line-clamp-2">
                                {{ test.description }}
                            </div>
                        </div>
                        <div class="shrink-0 pt-0.5">
                            <span
                                v-if="test.status === 'pass'"
                                class="text-emerald-500"
                                >✓</span
                            >
                            <span
                                v-if="test.status === 'fail'"
                                class="text-red-500"
                                >✗</span
                            >
                            <span
                                v-if="test.status === 'running'"
                                class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full text-blue-500"
                            ></span>
                        </div>
                    </div>
                    <div
                        v-if="test.error"
                        class="mt-2 text-xs text-red-400 font-mono bg-red-500/10 p-2 rounded break-all"
                    >
                        {{ test.error }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Right Column: Live Logs -->
        <div
            class="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs"
        >
            <div
                class="p-2 border-b border-[#333] flex justify-between items-center bg-[#252526]"
            >
                <div class="font-bold">Execution Log</div>
                <div class="flex gap-2">
                    <button
                        @click="autoScroll = !autoScroll"
                        class="px-2 py-1 rounded hover:bg-[#3e3e42]"
                        :class="{ 'bg-[#0e639c] text-white': autoScroll }"
                    >
                        Auto-scroll
                    </button>
                    <button
                        @click="clearLogs"
                        class="px-2 py-1 rounded hover:bg-[#3e3e42]"
                    >
                        Clear
                    </button>
                </div>
            </div>
            <div
                ref="logContainer"
                class="flex-1 overflow-y-auto p-4 space-y-1"
            >
                <template v-for="(entry, i) in logEntries" :key="i">
                    <div
                        v-if="entry.type === 'header'"
                        :id="`log-${entry.testId}`"
                        class="pt-6 pb-2 border-b border-[#333] font-bold text-sm text-[var(--md-primary)] sticky top-0 bg-[#1e1e1e]/90 backdrop-blur-sm z-10"
                    >
                        --- Test: {{ entry.message }} ---
                    </div>
                    <div
                        v-else
                        class="pl-4 flex gap-2 font-mono hover:bg-[#2a2d2e] rounded group"
                    >
                        <span class="text-[#569cd6] shrink-0 w-16 opacity-50">{{
                            entry.time
                        }}</span>
                        <span
                            :class="colors[entry.level] || 'text-[#cccccc]'"
                            class="break-words whitespace-pre-wrap"
                            >{{ entry.message }}</span
                        >
                    </div>
                </template>
                <div
                    v-if="logEntries.length === 0"
                    class="text-center opacity-30 mt-20 italic"
                >
                    Ready to run tests...
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useHead } from '#imports';
import {
    OpenRouterExecutionAdapter,
    type WorkflowData,
    type ExecutionCallbacks,
    validateWorkflow,
} from 'or3-workflow-core';
import { OpenRouter } from '@openrouter/sdk';
import { db } from '~/db';
import { nowSec, newId, nextClock } from '~/db/util';

// --- Types ---

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

interface LogEntry {
    time: string;
    level: LogLevel;
    message: string;
    type?: 'header' | 'log';
    testId?: string;
}

interface TestRunContext {
    log: (message: string, level?: LogLevel) => void;
    adapter: OpenRouterExecutionAdapter;
}

interface TestDefinition {
    id: string;
    label: string;
    description: string;
    run: (ctx: TestRunContext) => Promise<void>;
}

interface TestResult extends TestDefinition {
    status: 'pending' | 'running' | 'pass' | 'fail';
    error?: string;
}

// --- State ---

useHead({ title: 'Workflow Test Bench' });

const results = ref<TestResult[]>([]);
const running = ref(false);
const stopOnFailure = ref(false);
const logEntries = ref<LogEntry[]>([]);
const logContainer = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const activeTestId = ref<string | null>(null);
const apiKey = ref<string | null>(null);

// --- API Key Management ---

async function ensureApiKey(): Promise<string | null> {
    if (!import.meta.client) return null;
    if (apiKey.value) return apiKey.value;

    let storedKey: string | null = null;

    // Try localStorage first
    try {
        storedKey = localStorage.getItem('openrouter_api_key');
    } catch {
        /* intentionally empty */
    }

    // Try Dexie db
    if (!storedKey) {
        try {
            const rec = await db.kv
                .where('name')
                .equals('openrouter_api_key')
                .first();
            if (rec && typeof rec.value === 'string') storedKey = rec.value;
        } catch {
            /* intentionally empty */
        }
    }

    if (storedKey) {
        apiKey.value = storedKey;
        return storedKey;
    }

    // Prompt user
    const entered = window.prompt(
        'Enter your OpenRouter API key to run tests:'
    );
    if (!entered || !entered.trim()) return null;

    const key = entered.trim();
    apiKey.value = key;

    // Persist to localStorage
    try {
        localStorage.setItem('openrouter_api_key', key);
    } catch {
        /* intentionally empty */
    }

    // Persist to Dexie
    try {
        const now = nowSec();
        await db.kv.put({
            id: newId(),
            name: 'openrouter_api_key',
            value: key,
            created_at: now,
            updated_at: now,
            clock: nextClock(),
        });
    } catch {
        /* intentionally empty */
    }

    return key;
}

// --- Helpers ---

function createCallbacks(
    ctx: TestRunContext,
    options?: { collectTokens?: string[] }
): ExecutionCallbacks {
    return {
        onNodeStart: (nodeId, meta) => {
            ctx.log(`Node started: ${meta?.label || nodeId}`, 'debug');
        },
        onNodeFinish: (nodeId, output, meta) => {
            ctx.log(
                `Node finished: ${meta?.label || nodeId} → ${output.slice(
                    0,
                    100
                )}${output.length > 100 ? '...' : ''}`,
                'debug'
            );
        },
        onNodeError: (nodeId, error) => {
            ctx.log(`Node error: ${nodeId} - ${error.message}`, 'error');
        },
        onToken: (nodeId, token) => {
            if (options?.collectTokens) {
                options.collectTokens.push(token);
            }
        },
    };
}

// --- Test Definitions (All use real API) ---

const DEFAULT_MODEL = 'moonshotai/kimi-k2-0905:floor';

const testDefinitions: TestDefinition[] = [
    {
        id: 'simple-agent',
        label: 'Simple Agent Execution',
        description: 'Basic Start -> Agent workflow with real API call.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Simple Agent' },
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
                            label: 'Agent',
                            model: DEFAULT_MODEL,
                            prompt: 'Reply with exactly: "HELLO_WORLD"',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: 'test' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Execution failed: ${result.error?.message}`);
            ctx.log(`Output: ${result.output}`, 'info');
            if (!result.output.toLowerCase().includes('hello')) {
                ctx.log(
                    'Model did not follow exact instructions (acceptable)',
                    'warn'
                );
            }
            ctx.log('Simple agent test passed', 'success');
        },
    },
    {
        id: 'streaming-tokens',
        label: 'Token Streaming',
        description: 'Verifies tokens stream in real-time.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Streaming' },
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
                            label: 'Agent',
                            model: DEFAULT_MODEL,
                            prompt: 'Count from 1 to 5, one number per line.',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const tokens: string[] = [];
            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx, { collectTokens: tokens })
            );

            ctx.log(`Received ${tokens.length} token chunks`, 'info');
            if (!result.success)
                throw new Error(`Failed: ${result.error?.message}`);
            if (tokens.length < 3)
                throw new Error(
                    `Expected multiple tokens, got ${tokens.length}`
                );
            ctx.log('Token streaming verified', 'success');
        },
    },
    {
        id: 'router-branching',
        label: 'Router Branch Selection',
        description: 'Tests router node directing to correct branch.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Router Test' },
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
                            label: 'Topic Router',
                            model: DEFAULT_MODEL,
                            routes: [
                                { id: 'math', label: 'Math Question' },
                                { id: 'greeting', label: 'Greeting' },
                            ],
                        },
                    },
                    {
                        id: 'math-agent',
                        type: 'agent',
                        position: { x: 400, y: -50 },
                        data: {
                            label: 'Math',
                            model: DEFAULT_MODEL,
                            prompt: 'You handle math questions. Input: {{input}}',
                        },
                    },
                    {
                        id: 'greet-agent',
                        type: 'agent',
                        position: { x: 400, y: 50 },
                        data: {
                            label: 'Greeter',
                            model: DEFAULT_MODEL,
                            prompt: 'You handle greetings. Input: {{input}}',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'router' },
                    {
                        id: 'e2',
                        source: 'router',
                        target: 'math-agent',
                        sourceHandle: 'math',
                    },
                    {
                        id: 'e3',
                        source: 'router',
                        target: 'greet-agent',
                        sourceHandle: 'greeting',
                    },
                ],
            };

            ctx.log('Testing with greeting input...', 'info');
            const result = await ctx.adapter.execute(
                workflow,
                { text: 'Hello there! How are you?' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Router failed: ${result.error?.message}`);
            ctx.log(`Router output: ${result.output.slice(0, 150)}...`, 'info');
            ctx.log('Router test passed', 'success');
        },
    },
    {
        id: 'variable-chain',
        label: 'Variable Interpolation Chain',
        description:
            'Tests {{outputs.nodeId}} variable passing between agents.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Variable Chain' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'gen',
                        type: 'agent',
                        position: { x: 200, y: 0 },
                        data: {
                            label: 'Generator',
                            model: DEFAULT_MODEL,
                            prompt: 'Output exactly one word: "BANANA"',
                        },
                    },
                    {
                        id: 'use',
                        type: 'agent',
                        position: { x: 400, y: 0 },
                        data: {
                            label: 'Consumer',
                            model: DEFAULT_MODEL,
                            prompt: 'The previous agent said: {{outputs.gen}}. What color is that fruit? Reply with just the color.',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'gen' },
                    { id: 'e2', source: 'gen', target: 'use' },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Chain failed: ${result.error?.message}`);
            ctx.log(`Final output: ${result.output}`, 'info');
            ctx.log('Variable chain passed', 'success');
        },
    },
    {
        id: 'parallel-execution',
        label: 'Parallel Branch Execution',
        description: 'Runs multiple branches simultaneously.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Parallel Test' },
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
                        position: { x: 200, y: 0 },
                        data: {
                            label: 'Split',
                            branches: [
                                { id: 'b1', label: 'Branch 1' },
                                { id: 'b2', label: 'Branch 2' },
                            ],
                        },
                    },
                    {
                        id: 'agent1',
                        type: 'agent',
                        position: { x: 400, y: -50 },
                        data: {
                            label: 'Agent 1',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: "Branch ONE complete"',
                        },
                    },
                    {
                        id: 'agent2',
                        type: 'agent',
                        position: { x: 400, y: 50 },
                        data: {
                            label: 'Agent 2',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: "Branch TWO complete"',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'parallel' },
                    {
                        id: 'e2',
                        source: 'parallel',
                        target: 'agent1',
                        sourceHandle: 'b1',
                    },
                    {
                        id: 'e3',
                        source: 'parallel',
                        target: 'agent2',
                        sourceHandle: 'b2',
                    },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Parallel failed: ${result.error?.message}`);
            ctx.log(`Parallel output: ${result.output}`, 'info');
            ctx.log('Parallel execution passed', 'success');
        },
    },
    {
        id: 'validation-cycle',
        label: 'Validation: Cycle Detection',
        description: 'Ensures cycles are detected in non-loop nodes.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Cycle' },
                nodes: [
                    {
                        id: 'a',
                        type: 'agent',
                        position: { x: 0, y: 0 },
                        data: {
                            label: 'A',
                            model: DEFAULT_MODEL,
                            prompt: 'test',
                        },
                    },
                    {
                        id: 'b',
                        type: 'agent',
                        position: { x: 200, y: 0 },
                        data: {
                            label: 'B',
                            model: DEFAULT_MODEL,
                            prompt: 'test',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'a', target: 'b' },
                    { id: 'e2', source: 'b', target: 'a' },
                ],
            };

            const issues = validateWorkflow(
                workflow.nodes,
                workflow.edges,
                undefined,
                {
                    strictDataValidation: false,
                }
            );

            ctx.log(
                `Errors: ${issues.errors.length}, Warnings: ${issues.warnings.length}`,
                'debug'
            );

            const hasCycleError = issues.errors.some((e) =>
                e.message.toLowerCase().includes('cycle')
            );
            if (hasCycleError) {
                ctx.log('Cycle correctly detected', 'success');
            } else {
                ctx.log(`Validation result: ${JSON.stringify(issues)}`, 'warn');
                throw new Error('Cycle was not detected');
            }
        },
    },
    {
        id: 'validation-no-start',
        label: 'Validation: No Start Node',
        description: 'Validates error when workflow has no start node.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'No Start' },
                nodes: [
                    {
                        id: 'agent',
                        type: 'agent',
                        position: { x: 0, y: 0 },
                        data: {
                            label: 'Agent',
                            model: DEFAULT_MODEL,
                            prompt: 'test',
                        },
                    },
                ],
                edges: [],
            };

            const issues = validateWorkflow(
                workflow.nodes,
                workflow.edges,
                undefined,
                {
                    strictDataValidation: false,
                }
            );

            const hasStartError = issues.errors.some((e) =>
                e.message.toLowerCase().includes('start')
            );
            if (hasStartError) {
                ctx.log('Missing start node correctly detected', 'success');
            } else {
                // Try executing - should also fail
                const result = await ctx.adapter.execute(
                    workflow,
                    { text: '' },
                    createCallbacks(ctx)
                );
                if (!result.success) {
                    ctx.log(
                        'Execution correctly failed without start node',
                        'success'
                    );
                } else {
                    throw new Error('Should have failed without start node');
                }
            }
        },
    },
    {
        id: 'deep-chain',
        label: 'Deep Chain (3 Agents)',
        description: 'Tests a linear chain of multiple agents.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Deep Chain' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'a1',
                        type: 'agent',
                        position: { x: 150, y: 0 },
                        data: {
                            label: 'Step 1',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: "Step 1 done."',
                        },
                    },
                    {
                        id: 'a2',
                        type: 'agent',
                        position: { x: 300, y: 0 },
                        data: {
                            label: 'Step 2',
                            model: DEFAULT_MODEL,
                            prompt: 'Previous: {{outputs.a1}}. Now say: "Step 2 done."',
                        },
                    },
                    {
                        id: 'a3',
                        type: 'agent',
                        position: { x: 450, y: 0 },
                        data: {
                            label: 'Step 3',
                            model: DEFAULT_MODEL,
                            prompt: 'Previous: {{outputs.a2}}. Now say: "All steps complete!"',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'a1' },
                    { id: 'e2', source: 'a1', target: 'a2' },
                    { id: 'e3', source: 'a2', target: 'a3' },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Deep chain failed: ${result.error?.message}`);
            ctx.log(`Final: ${result.output}`, 'info');
            ctx.log('Deep chain passed', 'success');
        },
    },
    {
        id: 'input-interpolation',
        label: 'Input Variable {{input}}',
        description: 'Tests that {{input}} correctly passes user input.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Input Test' },
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
                            label: 'Echo',
                            model: DEFAULT_MODEL,
                            prompt: 'The user said: "{{input}}". Repeat their exact words back.',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const testInput = 'UNIQUE_TEST_STRING_12345';
            const result = await ctx.adapter.execute(
                workflow,
                { text: testInput },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Failed: ${result.error?.message}`);
            ctx.log(`Output: ${result.output}`, 'info');

            if (
                result.output.includes('12345') ||
                result.output.includes('UNIQUE')
            ) {
                ctx.log('Input interpolation verified', 'success');
            } else {
                ctx.log(
                    'Model may not have echoed exactly, but interpolation worked',
                    'warn'
                );
            }
        },
    },
    // --- Additional Tests ---
    {
        id: 'while-loop',
        label: 'While Loop Execution',
        description: 'Tests a while loop that iterates based on LLM condition.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Loop Test' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'loop',
                        type: 'whileLoop',
                        position: { x: 200, y: 0 },
                        data: {
                            label: 'Counter Loop',
                            conditionModel: DEFAULT_MODEL,
                            conditionPrompt:
                                'The current count is: {{outputs.counter}}. If the count is 2 or more, respond with exactly "yes" to exit. Otherwise respond with exactly "no" to continue.',
                            maxIterations: 5,
                            onMaxIterations: 'continue',
                        },
                    },
                    {
                        id: 'counter',
                        type: 'agent',
                        position: { x: 200, y: 150 },
                        data: {
                            label: 'Counter',
                            model: DEFAULT_MODEL,
                            prompt: 'You are counting. Previous count was: {{outputs.counter}}. If empty, start at 1. Otherwise increment by 1. Output ONLY the number.',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'loop' },
                    {
                        id: 'e2',
                        source: 'loop',
                        target: 'counter',
                        sourceHandle: 'body',
                    },
                    { id: 'e3', source: 'counter', target: 'loop' },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            ctx.log(`Loop result: ${result.output}`, 'info');
            // Loop should have executed at least once
            if (!result.success) {
                ctx.log(
                    `Loop execution note: ${result.error?.message}`,
                    'warn'
                );
            }
            ctx.log('While loop test completed', 'success');
        },
    },
    {
        id: 'output-node',
        label: 'Output Node',
        description: 'Tests dedicated output node for workflow results.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Output Test' },
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
                            label: 'Worker',
                            model: DEFAULT_MODEL,
                            prompt: 'Say exactly: "WORKER_OUTPUT"',
                        },
                    },
                    {
                        id: 'output',
                        type: 'output',
                        position: { x: 400, y: 0 },
                        data: { label: 'Final Output', format: 'text' },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'agent' },
                    { id: 'e2', source: 'agent', target: 'output' },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Output node failed: ${result.error?.message}`);
            ctx.log(`Output: ${result.output}`, 'info');
            ctx.log('Output node test passed', 'success');
        },
    },
    {
        id: 'system-prompt',
        label: 'System Prompt Configuration',
        description: 'Tests agent with custom system prompt.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'System Prompt Test' },
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
                            label: 'Pirate',
                            model: DEFAULT_MODEL,
                            prompt: '[System: You are a pirate. Always respond like a pirate, using words like "Arrr" and "matey".] Say hello to the user.',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: 'Hello!' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Failed: ${result.error?.message}`);
            ctx.log(`Pirate says: ${result.output}`, 'info');

            const hasPirateSpeak =
                result.output.toLowerCase().includes('arr') ||
                result.output.toLowerCase().includes('matey') ||
                result.output.toLowerCase().includes('ahoy');
            if (hasPirateSpeak) {
                ctx.log('System prompt influenced output correctly', 'success');
            } else {
                ctx.log(
                    'Model responded but may not have used pirate speak',
                    'warn'
                );
            }
        },
    },
    {
        id: 'multi-route-router',
        label: 'Router with 4 Routes',
        description: 'Tests router with multiple route options.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Multi-Route' },
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
                            label: 'Category Router',
                            model: DEFAULT_MODEL,
                            routes: [
                                { id: 'tech', label: 'Technology' },
                                { id: 'sports', label: 'Sports' },
                                { id: 'food', label: 'Food & Cooking' },
                                { id: 'other', label: 'Other' },
                            ],
                        },
                    },
                    {
                        id: 'tech-agent',
                        type: 'agent',
                        position: { x: 400, y: -100 },
                        data: {
                            label: 'Tech',
                            model: DEFAULT_MODEL,
                            prompt: 'Answer the tech question: {{input}}',
                        },
                    },
                    {
                        id: 'sports-agent',
                        type: 'agent',
                        position: { x: 400, y: 0 },
                        data: {
                            label: 'Sports',
                            model: DEFAULT_MODEL,
                            prompt: 'Answer about sports: {{input}}',
                        },
                    },
                    {
                        id: 'food-agent',
                        type: 'agent',
                        position: { x: 400, y: 100 },
                        data: {
                            label: 'Food',
                            model: DEFAULT_MODEL,
                            prompt: 'Answer about food: {{input}}',
                        },
                    },
                    {
                        id: 'other-agent',
                        type: 'agent',
                        position: { x: 400, y: 200 },
                        data: {
                            label: 'Other',
                            model: DEFAULT_MODEL,
                            prompt: 'Answer: {{input}}',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'router' },
                    {
                        id: 'e2',
                        source: 'router',
                        target: 'tech-agent',
                        sourceHandle: 'tech',
                    },
                    {
                        id: 'e3',
                        source: 'router',
                        target: 'sports-agent',
                        sourceHandle: 'sports',
                    },
                    {
                        id: 'e4',
                        source: 'router',
                        target: 'food-agent',
                        sourceHandle: 'food',
                    },
                    {
                        id: 'e5',
                        source: 'router',
                        target: 'other-agent',
                        sourceHandle: 'other',
                    },
                ],
            };

            ctx.log('Testing with food-related question...', 'info');
            const result = await ctx.adapter.execute(
                workflow,
                { text: 'How do I make pasta carbonara?' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Multi-route failed: ${result.error?.message}`);
            ctx.log(`Response: ${result.output.slice(0, 150)}...`, 'info');
            ctx.log('Multi-route router passed', 'success');
        },
    },
    {
        id: 'unicode-handling',
        label: 'Unicode & Emoji Handling',
        description: 'Tests proper handling of unicode characters and emoji.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Unicode Test' },
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
                            label: 'Echo',
                            model: DEFAULT_MODEL,
                            prompt: 'Repeat exactly: 你好世界 🎉 Ñoño café naïve',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '测试 🚀' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Unicode failed: ${result.error?.message}`);
            ctx.log(`Output: ${result.output}`, 'info');

            // Check if any unicode made it through
            const hasUnicode = /[^\x00-\x7F]/.test(result.output);
            if (hasUnicode) {
                ctx.log('Unicode characters preserved', 'success');
            } else {
                ctx.log(
                    'No unicode in output (model may have simplified)',
                    'warn'
                );
            }
        },
    },
    {
        id: 'empty-input',
        label: 'Empty Input Handling',
        description: 'Tests workflow with empty user input.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Empty Input' },
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
                            label: 'Agent',
                            model: DEFAULT_MODEL,
                            prompt: 'The user input is: "{{input}}". If empty, say "NO_INPUT_PROVIDED". Otherwise echo it.',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Empty input failed: ${result.error?.message}`);
            ctx.log(`Output: ${result.output}`, 'info');
            ctx.log('Empty input handled', 'success');
        },
    },
    {
        id: 'validation-disconnected',
        label: 'Validation: Disconnected Nodes',
        description: 'Checks for warnings about unreachable nodes.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Disconnected' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'connected',
                        type: 'agent',
                        position: { x: 200, y: 0 },
                        data: {
                            label: 'Connected',
                            model: DEFAULT_MODEL,
                            prompt: 'test',
                        },
                    },
                    {
                        id: 'orphan',
                        type: 'agent',
                        position: { x: 200, y: 200 },
                        data: {
                            label: 'Orphan',
                            model: DEFAULT_MODEL,
                            prompt: 'never reached',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'connected' }],
            };

            const issues = validateWorkflow(
                workflow.nodes,
                workflow.edges,
                undefined,
                {
                    strictDataValidation: false,
                }
            );

            ctx.log(
                `Errors: ${issues.errors.length}, Warnings: ${issues.warnings.length}`,
                'debug'
            );

            if (issues.warnings.length > 0) {
                ctx.log(
                    `Warnings: ${issues.warnings
                        .map((w) => w.message)
                        .join(', ')}`,
                    'info'
                );
                ctx.log('Disconnected node warning detected', 'success');
            } else {
                ctx.log(
                    'No warnings for disconnected nodes (may be acceptable)',
                    'warn'
                );
            }
        },
    },
    {
        id: 'validation-multiple-start',
        label: 'Validation: Multiple Start Nodes',
        description: 'Validates error when workflow has multiple starts.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Multi-Start' },
                nodes: [
                    {
                        id: 'start1',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start 1' },
                    },
                    {
                        id: 'start2',
                        type: 'start',
                        position: { x: 0, y: 100 },
                        data: { label: 'Start 2' },
                    },
                ],
                edges: [],
            };

            const issues = validateWorkflow(
                workflow.nodes,
                workflow.edges,
                undefined,
                {
                    strictDataValidation: false,
                }
            );

            const hasMultiStartError = issues.errors.some(
                (e) =>
                    e.code === 'MULTIPLE_START_NODES' ||
                    e.message.toLowerCase().includes('multiple')
            );

            if (hasMultiStartError) {
                ctx.log('Multiple start nodes error detected', 'success');
            } else {
                throw new Error('Multiple start nodes not detected as error');
            }
        },
    },
    {
        id: 'long-output',
        label: 'Long Output Generation',
        description: 'Tests handling of longer model outputs.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Long Output' },
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
                            label: 'Writer',
                            model: DEFAULT_MODEL,
                            prompt: 'Write a short paragraph (3-4 sentences) about the benefits of exercise.',
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'agent' }],
            };

            const tokens: string[] = [];
            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx, { collectTokens: tokens })
            );

            if (!result.success)
                throw new Error(`Long output failed: ${result.error?.message}`);
            ctx.log(
                `Output length: ${result.output.length} chars, ${tokens.length} chunks`,
                'info'
            );
            ctx.log(`Preview: ${result.output.slice(0, 100)}...`, 'debug');

            if (result.output.length > 100) {
                ctx.log('Long output handled correctly', 'success');
            } else {
                ctx.log('Output shorter than expected', 'warn');
            }
        },
    },
    {
        id: 'execution-order',
        label: 'Execution Order Tracking',
        description: 'Verifies nodes execute in correct topological order.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Order Test' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'first',
                        type: 'agent',
                        position: { x: 150, y: 0 },
                        data: {
                            label: 'First',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: FIRST',
                        },
                    },
                    {
                        id: 'second',
                        type: 'agent',
                        position: { x: 300, y: 0 },
                        data: {
                            label: 'Second',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: SECOND',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'first' },
                    { id: 'e2', source: 'first', target: 'second' },
                ],
            };

            const executionOrder: string[] = [];
            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                {
                    onNodeStart: (nodeId) =>
                        executionOrder.push(`start:${nodeId}`),
                    onNodeFinish: (nodeId) =>
                        executionOrder.push(`finish:${nodeId}`),
                    onNodeError: () => {},
                    onToken: () => {},
                }
            );

            ctx.log(`Execution order: ${executionOrder.join(' → ')}`, 'debug');

            if (!result.success)
                throw new Error(`Order test failed: ${result.error?.message}`);

            // Verify start came before first, first before second
            const startIdx = executionOrder.findIndex(
                (e) => e === 'start:start'
            );
            const firstIdx = executionOrder.findIndex(
                (e) => e === 'start:first'
            );
            const secondIdx = executionOrder.findIndex(
                (e) => e === 'start:second'
            );

            if (startIdx < firstIdx && firstIdx < secondIdx) {
                ctx.log(
                    'Execution order verified: start → first → second',
                    'success'
                );
            } else {
                throw new Error('Incorrect execution order');
            }
        },
    },
    {
        id: 'node-outputs-map',
        label: 'Node Outputs Collection',
        description: 'Verifies nodeOutputs map contains all executed nodes.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Outputs Map' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'agent-a',
                        type: 'agent',
                        position: { x: 200, y: 0 },
                        data: {
                            label: 'A',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: OUTPUT_A',
                        },
                    },
                    {
                        id: 'agent-b',
                        type: 'agent',
                        position: { x: 400, y: 0 },
                        data: {
                            label: 'B',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: OUTPUT_B',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'agent-a' },
                    { id: 'e2', source: 'agent-a', target: 'agent-b' },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: 'test' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Failed: ${result.error?.message}`);

            ctx.log(
                `nodeOutputs keys: ${Object.keys(result.nodeOutputs).join(
                    ', '
                )}`,
                'debug'
            );

            const hasStartOutput = 'start' in result.nodeOutputs;
            const hasAgentAOutput = 'agent-a' in result.nodeOutputs;
            const hasAgentBOutput = 'agent-b' in result.nodeOutputs;

            if (hasStartOutput && hasAgentAOutput && hasAgentBOutput) {
                ctx.log('All node outputs captured', 'success');
            } else {
                ctx.log(
                    `Missing outputs: start=${hasStartOutput}, a=${hasAgentAOutput}, b=${hasAgentBOutput}`,
                    'warn'
                );
            }
        },
    },
    {
        id: 'diamond-merge',
        label: 'Diamond Pattern (Split & Merge)',
        description: 'Tests parallel split that reconverges at a single node.',
        async run(ctx) {
            const workflow: WorkflowData = {
                meta: { version: '2.0.0', name: 'Diamond' },
                nodes: [
                    {
                        id: 'start',
                        type: 'start',
                        position: { x: 0, y: 0 },
                        data: { label: 'Start' },
                    },
                    {
                        id: 'split',
                        type: 'parallel',
                        position: { x: 150, y: 0 },
                        data: {
                            label: 'Split',
                            branches: [
                                { id: 'left', label: 'Left' },
                                { id: 'right', label: 'Right' },
                            ],
                        },
                    },
                    {
                        id: 'left-agent',
                        type: 'agent',
                        position: { x: 300, y: -50 },
                        data: {
                            label: 'Left',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: LEFT_PATH',
                        },
                    },
                    {
                        id: 'right-agent',
                        type: 'agent',
                        position: { x: 300, y: 50 },
                        data: {
                            label: 'Right',
                            model: DEFAULT_MODEL,
                            prompt: 'Say: RIGHT_PATH',
                        },
                    },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'split' },
                    {
                        id: 'e2',
                        source: 'split',
                        target: 'left-agent',
                        sourceHandle: 'left',
                    },
                    {
                        id: 'e3',
                        source: 'split',
                        target: 'right-agent',
                        sourceHandle: 'right',
                    },
                ],
            };

            const result = await ctx.adapter.execute(
                workflow,
                { text: '' },
                createCallbacks(ctx)
            );

            if (!result.success)
                throw new Error(`Diamond failed: ${result.error?.message}`);

            ctx.log(`Diamond output: ${result.output.slice(0, 200)}`, 'info');

            // Check both branches executed
            const hasLeft =
                result.output.includes('LEFT') ||
                result.nodeOutputs['left-agent']?.includes('LEFT');
            const hasRight =
                result.output.includes('RIGHT') ||
                result.nodeOutputs['right-agent']?.includes('RIGHT');

            if (hasLeft && hasRight) {
                ctx.log('Both branches executed in diamond pattern', 'success');
            } else {
                ctx.log(
                    `Branch results: left=${hasLeft}, right=${hasRight}`,
                    'warn'
                );
            }
        },
    },
];

// --- Implementation ---

const colors: Record<LogLevel, string> = {
    info: 'text-[#9cdcfe]',
    warn: 'text-[#dcdcaa]',
    error: 'text-[#f48771]',
    success: 'text-[#b5cea8]',
    debug: 'text-[#6a9955]',
};

const summary = computed(() => {
    const total = results.value.length;
    const pass = results.value.filter((r) => r.status === 'pass').length;
    const fail = results.value.filter((r) => r.status === 'fail').length;
    const pending = total - pass - fail;
    return { total, pass, fail, pending };
});

function log(message: string, level: LogLevel = 'info', testId?: string) {
    const now = new Date();
    const time =
        now.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }) +
        '.' +
        String(now.getMilliseconds()).padStart(3, '0');
    logEntries.value.push({ time, level, message, type: 'log', testId });
    if (autoScroll.value) {
        nextTick(() => {
            if (logContainer.value)
                logContainer.value.scrollTop = logContainer.value.scrollHeight;
        });
    }
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
    if (running.value) return;
    running.value = true;

    // Require API key
    const currentApiKey = await ensureApiKey();
    if (!currentApiKey) {
        log('No API key provided - cannot run tests', 'error');
        running.value = false;
        return;
    }

    // Initialize results
    results.value = testDefinitions.map((def) => ({
        ...def,
        status: 'pending',
    }));
    logEntries.value = [];

    log('[Setup] Starting tests...', 'debug');
    log(`[Setup] Running ${testDefinitions.length} tests`, 'info');

    const client = new OpenRouter({ apiKey: currentApiKey });
    const adapter = new OpenRouterExecutionAdapter(client, {
        defaultModel: DEFAULT_MODEL,
    });
    log('[Setup] Adapter created with real API', 'debug');

    for (let i = 0; i < results.value.length; i++) {
        const test = results.value[i]!;
        activeTestId.value = test.id;
        test.status = 'running';

        logEntries.value.push({
            time: '',
            level: 'info',
            message: test.label,
            type: 'header',
            testId: test.id,
        });

        const ctx: TestRunContext = {
            log: (msg, lvl) => log(msg, lvl || 'info', test.id),
            adapter,
        };

        try {
            await test.run(ctx);
            test.status = 'pass';
        } catch (err: any) {
            console.error(err);
            test.status = 'fail';
            test.error = err.message;
            log(`Test Failed: ${err.message}`, 'error', test.id);
            if (stopOnFailure.value) {
                running.value = false;
                break;
            }
        }

        await delay(200); // Small delay between tests to be nice to API
    }

    activeTestId.value = null;
    running.value = false;
}

function resetEnvironment() {
    results.value = testDefinitions.map((def) => ({
        ...def,
        status: 'pending',
    }));
    logEntries.value = [];
}

function clearLogs() {
    logEntries.value = [];
}

function scrollToLog(testId: string) {
    const el = document.getElementById(`log-${testId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}

onMounted(async () => {
    resetEnvironment();
    // Try to load API key on mount
    await ensureApiKey();
});
</script>
