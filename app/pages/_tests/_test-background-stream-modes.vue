<template>
    <main class="h-full min-h-0 overflow-y-auto mx-auto max-w-7xl p-6 pb-10 space-y-6" data-testid="background-stream-modes-page">
        <header class="space-y-2">
            <h1 class="text-2xl font-semibold">Background Stream Modes Harness</h1>
            <p class="text-sm opacity-80">
                Runs three end-to-end checks: normal background stream, background workflow execution, and background stream with tool calling.
            </p>
        </header>

        <section class="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr] items-start">
            <div class="space-y-4">
                <UCard>
                    <template #header>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="font-medium">Controls</span>
                            <div class="flex flex-wrap gap-2">
                                <UButton
                                    data-testid="bg-modes-run-all"
                                    color="primary"
                                    :loading="isRunning"
                                    @click="runAllTests"
                                >
                                    Run All
                                </UButton>
                                <UButton
                                    data-testid="bg-modes-clear-logs"
                                    color="neutral"
                                    variant="soft"
                                    :disabled="isRunning"
                                    @click="clearLogs"
                                >
                                    Clear Logs
                                </UButton>
                            </div>
                        </div>
                    </template>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div class="space-y-1">
                            <label class="opacity-80" for="bg-model-id">Model</label>
                            <UInput
                                id="bg-model-id"
                                v-model="modelId"
                                data-testid="bg-modes-model-input"
                                :disabled="isRunning"
                            />
                        </div>
                        <div class="space-y-1">
                            <div class="opacity-80">Workflow Fixture</div>
                            <div class="flex items-center gap-2">
                                <UBadge
                                    :color="firstWorkflowPost ? 'success' : 'warning'"
                                    variant="soft"
                                    data-testid="bg-modes-workflow-count"
                                >
                                    {{ firstWorkflowPost ? 'available' : 'missing' }}
                                </UBadge>
                                <span class="truncate" data-testid="bg-modes-workflow-name">
                                    {{ firstWorkflowPost?.title || 'No local workflow-entry found' }}
                                </span>
                            </div>
                        </div>
                    </div>
                </UCard>

                <section class="space-y-3">
                    <UCard v-for="testId in TEST_ORDER" :key="testId">
                        <template #header>
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex items-center gap-2">
                                    <span class="font-medium">{{ TEST_META[testId].title }}</span>
                                    <UBadge
                                        :color="statusColor(testStates[testId].status)"
                                        variant="soft"
                                        :data-testid="`bg-modes-status-${testId}`"
                                    >
                                        {{ testStates[testId].status }}
                                    </UBadge>
                                </div>
                                <UButton
                                    :data-testid="`bg-modes-run-${testId}`"
                                    color="primary"
                                    variant="outline"
                                    size="sm"
                                    :loading="activeTestId === testId"
                                    :disabled="isRunning && activeTestId !== testId"
                                    @click="runTest(testId)"
                                >
                                    Run Test
                                </UButton>
                            </div>
                        </template>

                        <div class="space-y-2 text-sm">
                            <p class="opacity-80">{{ TEST_META[testId].description }}</p>
                            <div v-if="testStates[testId].jobId" :data-testid="`bg-modes-job-${testId}`">
                                Job:
                                <code>{{ testStates[testId].jobId }}</code>
                            </div>
                            <div v-if="testStates[testId].durationMs !== null">
                                Duration: {{ formatDuration(testStates[testId].durationMs) }}
                            </div>
                            <div v-if="testStates[testId].detail" class="text-xs opacity-90">
                                {{ testStates[testId].detail }}
                            </div>
                        </div>
                    </UCard>
                </section>
            </div>

            <UCard class="min-h-[28rem] max-h-[80vh] flex flex-col">
                <template #header>
                    <div class="flex items-center justify-between">
                        <span class="font-medium">Live Logs</span>
                        <UBadge
                            :color="isRunning ? 'warning' : 'success'"
                            variant="soft"
                            data-testid="bg-modes-running-state"
                        >
                            {{ isRunning ? `running: ${activeTestId}` : 'idle' }}
                        </UBadge>
                    </div>
                </template>
                <pre
                    ref="logPaneRef"
                    class="flex-1 max-h-[65vh] overflow-auto text-xs whitespace-pre-wrap rounded border border-default p-3"
                    data-testid="bg-modes-log-pane"
                >{{ logText || '[No logs yet]' }}</pre>
            </UCard>
        </section>
    </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { usePostsList } from '~/composables/posts/usePostsList';
import {
    pollJobStatus,
    startBackgroundStream,
    type BackgroundJobStatus,
} from '~/utils/chat/openrouterStream';
import { startBackgroundWorkflow } from '~/utils/chat/backgroundWorkflow';
import type { ToolDefinition } from '~/utils/chat/types';

type TestId = 'normal' | 'workflow' | 'tools';
type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

type TestState = {
    status: TestStatus;
    detail: string;
    jobId: string | null;
    durationMs: number | null;
};

type TestOutcome = {
    pass: boolean;
    detail: string;
    jobId?: string;
};

const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const POLL_INTERVAL_MS = 900;
const JOB_TIMEOUT_MS = 120_000;

const TEST_ORDER: TestId[] = ['normal', 'workflow', 'tools'];
const TEST_META: Record<TestId, { title: string; description: string }> = {
    normal: {
        title: 'Background Stream: Normal',
        description:
            'Starts a standard background AI stream and verifies a complete terminal state with content.',
    },
    workflow: {
        title: 'Background Stream: Workflow',
        description:
            'Starts /api/workflows/background using a local workflow-entry id and verifies workflow completion state.',
    },
    tools: {
        title: 'Background Stream: Tool Calling',
        description:
            'Starts background streaming with add_numbers tool and verifies a completed tool invocation.',
    },
};

const ADD_NUMBERS_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'add_numbers',
        description: 'Add two numbers and return the sum.',
        parameters: {
            type: 'object',
            properties: {
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
            },
            required: ['a', 'b'],
        },
    },
    runtime: 'hybrid',
};

const modelId = ref(DEFAULT_MODEL);
const logs = ref<string[]>([]);
const activeTestId = ref<TestId | null>(null);
const logPaneRef = ref<HTMLElement | null>(null);

const testStates = reactive<Record<TestId, TestState>>({
    normal: { status: 'idle', detail: '', jobId: null, durationMs: null },
    workflow: { status: 'idle', detail: '', jobId: null, durationMs: null },
    tools: { status: 'idle', detail: '', jobId: null, durationMs: null },
});

const isRunning = computed(() => activeTestId.value !== null);
const logText = computed(() => logs.value.join('\n'));

const {
    items: workflowPosts,
    loading: workflowPostsLoading,
} = usePostsList('workflow-entry', {
    limit: 50,
    sort: 'updated_at',
    sortDir: 'desc',
});
const firstWorkflowPost = computed(() => workflowPosts.value[0] ?? null);

function nowIso(): string {
    return new Date().toISOString();
}

function appendLog(message: string): void {
    logs.value.push(`[${nowIso()}] ${message}`);
    setTimeout(() => {
        const el = logPaneRef.value;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, 0);
}

function clearLogs(): void {
    logs.value = [];
}

function formatDuration(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
}

function statusColor(status: TestStatus): 'neutral' | 'primary' | 'warning' | 'success' | 'error' {
    if (status === 'running') return 'primary';
    if (status === 'pass') return 'success';
    if (status === 'fail') return 'error';
    return 'neutral';
}

function contentLength(status: BackgroundJobStatus): number {
    if (typeof status.content_length === 'number' && Number.isFinite(status.content_length)) {
        return status.content_length;
    }
    return typeof status.content === 'string' ? status.content.length : 0;
}

function truncate(value: string, max = 220): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...(${value.length})`;
}

function compactJson(value: unknown, max = 800): string {
    try {
        const text = JSON.stringify(
            value,
            (_key, candidate: unknown): unknown => {
                if (typeof candidate === 'string') {
                    return candidate.length > 160
                        ? `${candidate.slice(0, 160)}...(${candidate.length})`
                        : candidate;
                }
                return candidate;
            }
        );
        if (typeof text !== 'string') return String(value);
        return text.length > max ? `${text.slice(0, max)}...(${text.length})` : text;
    } catch {
        return String(value);
    }
}

function summarizeToolCall(call: NonNullable<BackgroundJobStatus['tool_calls']>[number]): string {
    const args = call.args ? `args=${truncate(call.args, 90)}` : 'args=<none>';
    const result = call.result ? `result=${truncate(call.result, 90)}` : null;
    const error = call.error ? `error=${truncate(call.error, 90)}` : null;
    return [
        `${call.name}#${call.id ?? 'no-id'}`,
        `status=${call.status}`,
        args,
        result,
        error,
    ]
        .filter(Boolean)
        .join(' ');
}

function createThreadAndMessageIds(prefix: string): { threadId: string; messageId: string } {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        threadId: `${prefix}-thread-${suffix}`,
        messageId: `${prefix}-message-${suffix}`,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitForTerminalStatus(params: {
    label: string;
    jobId: string;
    timeoutMs?: number;
    onUpdate?: (status: BackgroundJobStatus) => void;
}): Promise<BackgroundJobStatus> {
    const timeoutMs = params.timeoutMs ?? JOB_TIMEOUT_MS;
    const startedAt = Date.now();
    let lastSnapshot = '';

    while (Date.now() - startedAt < timeoutMs) {
        const status = await pollJobStatus(params.jobId);
        params.onUpdate?.(status);
        const tools = status.tool_calls ?? [];
        const chars = contentLength(status);
        const toolSummary = tools
            .map((call) => `${call.name}:${call.status}`)
            .join(',');
        const executionState = status.workflow_state?.executionState ?? '';
        const workflowVersion = status.workflow_state?.version ?? '';
        const errorSummary =
            typeof status.error === 'string' ? truncate(status.error, 140) : '';

        const snapshot = [
            status.status,
            status.chunksReceived,
            chars,
            tools.length,
            toolSummary,
            executionState,
            workflowVersion,
            errorSummary,
        ].join('|');
        if (snapshot !== lastSnapshot) {
            const completionTime =
                typeof status.completedAt === 'number'
                    ? new Date(status.completedAt).toISOString()
                    : 'n/a';
            appendLog(
                `[${params.label}] status=${status.status} model=${status.model} chunks=${status.chunksReceived} chars=${chars} tools=${tools.length} completedAt=${completionTime}${
                    errorSummary ? ` error=${errorSummary}` : ''
                }`
            );
            if (tools.length > 0) {
                appendLog(
                    `[${params.label}] tool-calls ${tools
                        .map((call) => summarizeToolCall(call))
                        .join(' | ')}`
                );
            }
            const previewSource =
                typeof status.content_delta === 'string' &&
                status.content_delta.length > 0
                    ? status.content_delta
                    : typeof status.content === 'string'
                    ? status.content
                    : '';
            if (previewSource.length > 0) {
                appendLog(
                    `[${params.label}] content-preview="${truncate(
                        previewSource,
                        170
                    )}"`
                );
            }
            if (status.workflow_state && typeof status.workflow_state === 'object') {
                appendLog(
                    `[${params.label}] workflow execution=${status.workflow_state.executionState ?? 'unknown'} version=${status.workflow_state.version ?? '?'} currentNode=${status.workflow_state.currentNodeId ?? 'null'}`
                );
            }
            lastSnapshot = snapshot;
        }

        if (status.status !== 'streaming') {
            return status;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
        `[${params.label}] timed out after ${Math.round(timeoutMs / 1000)}s`
    );
}

async function executeTest(
    testId: TestId,
    runner: () => Promise<TestOutcome>
): Promise<void> {
    if (activeTestId.value !== null) {
        appendLog(
            `[${testId}] skipped because "${activeTestId.value}" is currently running`
        );
        return;
    }

    activeTestId.value = testId;
    const state = testStates[testId];
    state.status = 'running';
    state.detail = '';
    state.jobId = null;
    state.durationMs = null;

    const startedAt = Date.now();
    appendLog(`[${testId}] starting`);

    try {
        const outcome = await runner();
        state.status = outcome.pass ? 'pass' : 'fail';
        state.detail = outcome.detail;
        state.jobId = outcome.jobId ?? state.jobId;
        state.durationMs = Date.now() - startedAt;
        appendLog(
            `[${testId}] ${outcome.pass ? 'PASS' : 'FAIL'} - ${outcome.detail}`
        );
    } catch (error) {
        state.status = 'fail';
        state.detail = error instanceof Error ? error.message : String(error);
        state.durationMs = Date.now() - startedAt;
        appendLog(`[${testId}] ERROR - ${state.detail}`);
    } finally {
        activeTestId.value = null;
    }
}

async function runNormalTest(): Promise<void> {
    await executeTest('normal', async () => {
        const ids = createThreadAndMessageIds('normal-bg');
        const response = await startBackgroundStream({
            model: modelId.value.trim() || DEFAULT_MODEL,
            orMessages: [
                {
                    role: 'user',
                    content:
                        'Write exactly two short lines about resilient background processing.',
                },
            ],
            modalities: ['text'],
            threadId: ids.threadId,
            messageId: ids.messageId,
        });

        appendLog(`[normal] started job ${response.jobId}`);

        const terminal = await waitForTerminalStatus({
            label: 'normal',
            jobId: response.jobId,
        });
        const chars = contentLength(terminal);

        if (terminal.status === 'complete' && chars > 0) {
            return {
                pass: true,
                jobId: response.jobId,
                detail: `Complete with ${chars} chars`,
            };
        }

        if (terminal.status === 'error') {
            return {
                pass: false,
                jobId: response.jobId,
                detail: `Error: ${terminal.error ?? 'unknown error'}`,
            };
        }

        return {
            pass: false,
            jobId: response.jobId,
            detail: `Unexpected terminal status "${terminal.status}"`,
        };
    });
}

async function runWorkflowTest(): Promise<void> {
    await executeTest('workflow', async () => {
        if (workflowPostsLoading.value) {
            return {
                pass: false,
                detail: 'Workflow list is still loading; retry in a moment.',
            };
        }

        const workflow = firstWorkflowPost.value;
        if (!workflow) {
            return {
                pass: false,
                detail:
                    'No local workflow-entry found. Create one in Workflows first.',
            };
        }

        const ids = createThreadAndMessageIds('workflow-bg');
        appendLog(`[workflow] using workflowId=${workflow.id}`);

        const response = await startBackgroundWorkflow({
            workflowId: workflow.id,
            prompt:
                'Generate a concise verse about confidence and respect. Keep it under six lines.',
            threadId: ids.threadId,
            messageId: ids.messageId,
            conversationHistory: [
                {
                    role: 'user',
                    content: 'Please run the selected workflow in background mode.',
                },
            ],
        });

        appendLog(`[workflow] started job ${response.jobId}`);

        const terminal = await waitForTerminalStatus({
            label: 'workflow',
            jobId: response.jobId,
        });
        const executionState = terminal.workflow_state?.executionState;
        const version = terminal.workflow_state?.version;

        if (
            terminal.status === 'complete' &&
            executionState === 'completed'
        ) {
            return {
                pass: true,
                jobId: response.jobId,
                detail: `Complete with workflow_state=${executionState} (v${version ?? '?'})`,
            };
        }

        if (terminal.status === 'error') {
            return {
                pass: false,
                jobId: response.jobId,
                detail: `Error: ${terminal.error ?? 'unknown error'}`,
            };
        }

        return {
            pass: false,
            jobId: response.jobId,
            detail: `Terminal status=${terminal.status}, workflow_state=${executionState ?? 'missing'}`,
        };
    });
}

async function runToolsTest(): Promise<void> {
    await executeTest('tools', async () => {
        const ids = createThreadAndMessageIds('tools-bg');
        let sawAddNumbersCall = false;
        let sawAddNumbersComplete = false;
        let sawAddNumbersFailure: string | null = null;
        const selectedModel = modelId.value.trim() || DEFAULT_MODEL;
        const toolPrompt =
            'You must use the add_numbers tool for a=19 and b=23 before answering. Do not compute manually. After the tool result, reply with only the numeric sum.';
        const forcedToolChoice = {
            type: 'function' as const,
            function: {
                name: ADD_NUMBERS_TOOL.function.name,
            },
        };
        const toolRuntime = {
            add_numbers: 'hybrid',
        } as const;

        appendLog(
            `[tools] request model=${selectedModel} threadId=${ids.threadId} messageId=${ids.messageId} tool_choice=${compactJson(
                forcedToolChoice,
                220
            )}`
        );
        appendLog(
            `[tools] request tools=${ADD_NUMBERS_TOOL.function.name} runtime=${ADD_NUMBERS_TOOL.runtime ?? 'unspecified'}`
        );
        appendLog(
            `[tools] request toolRuntime=${compactJson(toolRuntime, 200)}`
        );
        appendLog(
            `[tools] request toolSchema=${compactJson(
                ADD_NUMBERS_TOOL.function.parameters,
                420
            )}`
        );
        appendLog(`[tools] prompt="${truncate(toolPrompt, 260)}"`);

        const response = await startBackgroundStream({
            model: selectedModel,
            orMessages: [
                {
                    role: 'user',
                    content: toolPrompt,
                },
            ],
            modalities: ['text'],
            threadId: ids.threadId,
            messageId: ids.messageId,
            tools: [ADD_NUMBERS_TOOL],
            toolChoice: forcedToolChoice,
            toolRuntime,
        });

        appendLog(`[tools] started job ${response.jobId}`);

        const terminal = await waitForTerminalStatus({
            label: 'tools',
            jobId: response.jobId,
            onUpdate: (status) => {
                for (const call of status.tool_calls ?? []) {
                    if (call.name !== 'add_numbers') continue;
                    sawAddNumbersCall = true;
                    if (call.status === 'complete') {
                        sawAddNumbersComplete = true;
                    }
                    if (call.status === 'error' || call.status === 'skipped') {
                        sawAddNumbersFailure = call.error ?? call.status;
                    }
                }
            },
        });
        appendLog(
            `[tools] terminal payload ${compactJson(
                {
                    id: terminal.id,
                    status: terminal.status,
                    model: terminal.model,
                    chunksReceived: terminal.chunksReceived,
                    contentLength: contentLength(terminal),
                    content: terminal.content ?? null,
                    error: terminal.error ?? null,
                    tool_calls: terminal.tool_calls ?? [],
                },
                1800
            )}`
        );

        if (
            terminal.status === 'complete' &&
            sawAddNumbersCall &&
            sawAddNumbersComplete
        ) {
            return {
                pass: true,
                jobId: response.jobId,
                detail: 'Tool call executed and completed in background mode.',
            };
        }

        if (terminal.status === 'error') {
            return {
                pass: false,
                jobId: response.jobId,
                detail: `Error: ${terminal.error ?? 'unknown error'}`,
            };
        }

        if (!sawAddNumbersCall) {
            const outputPreview =
                typeof terminal.content === 'string' && terminal.content.length > 0
                    ? truncate(terminal.content, 120)
                    : '[empty]';
            return {
                pass: false,
                jobId: response.jobId,
                detail:
                    `Completed without add_numbers tool invocation. tools=${terminal.tool_calls?.length ?? 0}, chars=${contentLength(terminal)}, output=${outputPreview}`,
            };
        }

        return {
            pass: false,
            jobId: response.jobId,
            detail: `Tool call did not complete (${sawAddNumbersFailure ?? 'no completion state'})`,
        };
    });
}

async function runTest(testId: TestId): Promise<void> {
    if (testId === 'normal') {
        await runNormalTest();
        return;
    }
    if (testId === 'workflow') {
        await runWorkflowTest();
        return;
    }
    await runToolsTest();
}

async function runAllTests(): Promise<void> {
    if (isRunning.value) {
        appendLog('[all] ignored: a test is already running');
        return;
    }

    appendLog('[all] starting full background stream suite');
    for (const testId of TEST_ORDER) {
        await runTest(testId);
    }
    appendLog('[all] suite finished');
}
</script>
