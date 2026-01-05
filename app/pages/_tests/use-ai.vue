<template>
    <div class="h-[100dvh] overflow-y-auto py-8 px-4">
        <div class="max-w-5xl mx-auto space-y-6">
            <section class="space-y-3">
                <header class="space-y-2">
                    <h1
                        class="font-['Press_Start_2P'] text-[18px] uppercase tracking-[0.2em] fx-main-text"
                    >
                        useChat Frontend Test Bench
                    </h1>
                    <p class="text-[17px] opacity-80 max-w-3xl fx-main-text">
                        Manual harness that exercises the chat composable
                        end-to-end: API key hydration, streaming, persistence,
                        retry, abort, filters, model selection, and image
                        attachment handling. Run these before shipping to ensure
                        the retro chat loop still behaves.
                    </p>
                </header>
                <div class="flex flex-wrap items-center gap-3">
                    <UButton
                        variant="basic"
                        size="md"
                        class="theme-btn"
                        :loading="running"
                        :disabled="running"
                        @click="runTests"
                    >
                        Run all tests
                    </UButton>
                    <div
                        class="border-[var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] theme-shadow bg-[var(--md-inverse-surface)]/5 px-4 py-3 flex items-center gap-4 text-[15px]"
                    >
                        <span class="uppercase tracking-[0.2em] text-[13px]">
                            Progress
                        </span>
                        <span class="font-mono text-[17px]">
                            {{ summary.pass }} / {{ summary.total }} passed
                        </span>
                        <span
                            v-if="summary.fail"
                            class="font-mono text-[17px] text-red-400"
                        >
                            Fails: {{ summary.fail }}
                        </span>
                        <span
                            v-else
                            class="font-mono text-[17px] text-emerald-400"
                        >
                            Pending: {{ summary.pending }}
                        </span>
                    </div>
                </div>
            </section>

            <section class="grid gap-4">
                <div
                    v-for="result in results"
                    :key="result.id"
                    class="border-[var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] theme-shadow bg-[var(--md-inverse-surface)]/5 p-4 space-y-3"
                >
                    <header class="flex items-start justify-between gap-3">
                        <div class="space-y-1">
                            <h2
                                class="font-['Press_Start_2P'] text-[13px] uppercase tracking-[0.18em] leading-tight fx-main-text"
                            >
                                {{ result.label }}
                            </h2>
                            <p class="text-[15px] opacity-80 fx-main-text">
                                {{ result.description }}
                            </p>
                        </div>
                        <div
                            class="flex items-center gap-1 text-[15px] font-mono"
                            :class="statusColors[result.status]"
                        >
                            <UIcon
                                v-if="result.status === 'pass'"
                                :name="useIcon('ui.check').value"
                                class="w-4 h-4"
                            />
                            <UIcon
                                v-else-if="result.status === 'fail'"
                                :name="useIcon('ui.close').value"
                                class="w-4 h-4"
                            />
                            <UIcon
                                v-else
                                :name="useIcon('ui.wait').value"
                                class="w-4 h-4 animate-pulse"
                            />
                            <span>{{ result.status.toUpperCase() }}</span>
                        </div>
                    </header>

                    <ul
                        v-if="result.logs.length"
                        class="list-disc list-inside space-y-1 text-[15px]"
                    >
                        <li v-for="(log, idx) in result.logs" :key="idx">
                            {{ log }}
                        </li>
                    </ul>

                    <div
                        v-if="result.error"
                        class="border border-red-500/60 bg-red-500/10 text-red-400 text-[14px] px-3 py-2 rounded-[var(--md-border-radius)] whitespace-pre-wrap"
                    >
                        {{ result.error }}
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useHead, useIcon } from '#imports';
import { useChat } from '~/composables/chat/useAi';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import type { ChatMessage } from '~/utils/chat/types';
import { db } from '~/db';
import { state } from '~/state/global';
import { nowSec, newId } from '~/db/util';
import { useHooks } from '~/core/hooks/useHooks';
import { deriveMessageContent } from '~/utils/chat/messages';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchHandler = (input: FetchInput, init?: FetchInit) => Promise<Response>;

interface TestRunContext {
    log: (message: string) => void;
    cleanup: (fn: () => void | Promise<void>) => void;
    reset: () => Promise<void>;
    enqueueFetch: (handler: FetchHandler) => void;
    waitFor: typeof waitFor;
}

interface TestDefinition {
    id: string;
    label: string;
    description: string;
    run: (ctx: TestRunContext) => Promise<void>;
}

interface TestResult extends TestDefinition {
    status: 'pending' | 'pass' | 'fail';
    logs: string[];
    error?: string;
    stack?: string;
}

useHead({
    title: 'useChat Frontend Test Bench',
});

const hooks = useHooks();

const results = ref<TestResult[]>([]);
const running = ref(false);

const fetchQueue: FetchHandler[] = [];
let originalFetch: typeof globalThis.fetch | null = import.meta.client
    ? globalThis.fetch.bind(globalThis)
    : null;

const paneStub = ref([
    {
        id: 'pane-test',
        mode: 'chat' as const,
        threadId: undefined as string | undefined,
    },
]);

if (import.meta.client) {
    const g = globalThis as any;
    if (!g.__or3MultiPaneApi) {
        g.__or3MultiPaneApi = {
            panes: paneStub,
            activePaneIndex: ref(0),
        };
    } else {
        if (!g.__or3MultiPaneApi.panes) g.__or3MultiPaneApi.panes = paneStub;
        if (!g.__or3MultiPaneApi.activePaneIndex)
            g.__or3MultiPaneApi.activePaneIndex = ref(0);
    }
}

const statusColors: Record<TestResult['status'], string> = {
    pass: 'text-emerald-400',
    fail: 'text-red-400',
    pending: 'text-yellow-400',
};

const summary = computed(() => {
    const total = results.value.length;
    const pass = results.value.filter((r) => r.status === 'pass').length;
    const fail = results.value.filter((r) => r.status === 'fail').length;
    const pending = total - pass - fail;
    return { total, pass, fail, pending };
});

async function ensureApiKey(): Promise<void> {
    if (!import.meta.client) return;
    if (state.value.openrouterKey) return;
    let storedKey: string | null = null;
    try {
        storedKey = localStorage.getItem('openrouter_api_key');
    } catch {
        /* intentionally empty */
    }
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
        state.value.openrouterKey = storedKey;
        return;
    }
    const entered = window.prompt(
        'Enter your OpenRouter API key to run tests:'
    );
    if (!entered || !entered.trim()) return;
    const key = entered.trim();
    state.value.openrouterKey = key;
    try {
        localStorage.setItem('openrouter_api_key', key);
    } catch {
        /* intentionally empty */
    }
    try {
        const now = nowSec();
        await db.kv.put({
            id: newId(),
            name: 'openrouter_api_key',
            value: key,
            created_at: now,
            updated_at: now,
            clock: 0,
        });
    } catch {
        /* intentionally empty */
    }
}

function createTestResult(def: TestDefinition): TestResult {
    return {
        ...def,
        status: 'pending',
        logs: [],
    };
}

function toUrl(input: FetchInput): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return (input as Request)?.url ?? '';
}

function installFetchStub() {
    if (!import.meta.client) return;
    const g = globalThis as any;
    if (g.__useAiTestFetchInstalled) return;
    if (!originalFetch && typeof g.fetch === 'function') {
        originalFetch = g.fetch.bind(g);
    }
    g.fetch = async (input: FetchInput, init?: FetchInit) => {
        const url = toUrl(input);
        if (
            url.includes('openrouter.ai/api/v1/chat/completions') ||
            url.includes('/api/openrouter/stream')
        ) {
            if (!fetchQueue.length) {
                throw new Error(
                    'No mock fetch handler enqueued for OpenRouter request'
                );
            }
            const handler = fetchQueue.shift()!;
            return handler(input, init);
        }
        if (originalFetch) return originalFetch(input as any, init);
        throw new Error('No fetch implementation available');
    };
    g.__useAiTestFetchInstalled = true;
}

function uninstallFetchStub() {
    if (!import.meta.client) return;
    const g = globalThis as any;
    if (originalFetch) {
        g.fetch = originalFetch;
    }
    g.__useAiTestFetchInstalled = false;
}

function enqueueFetch(handler: FetchHandler) {
    fetchQueue.push(handler);
}

async function resetDexie() {
    try {
        if (!db.isOpen()) await db.open();
    } catch {
        try {
            await db.open();
        } catch (error) {
            throw new Error(
                `Failed to open Dexie: ${(error as Error).message}`
            );
        }
    }
    await db.transaction(
        'rw',
        [
            db.projects,
            db.threads,
            db.messages,
            db.kv,
            db.attachments,
            db.file_meta,
            db.file_blobs,
            db.posts,
        ],
        async () => {
            await db.projects.clear();
            await db.threads.clear();
            await db.messages.clear();
            await db.kv.clear();
            await db.attachments.clear();
            await db.file_meta.clear();
            await db.file_blobs.clear();
            await db.posts.clear();
        }
    );
    // Preserve openrouterKey so tests can run without re-authentication
    // state.value.openrouterKey = null;
    try {
        localStorage.removeItem('last_selected_model');
    } catch {}
}

function resetPaneStub() {
    paneStub.value = [{ id: 'pane-test', mode: 'chat', threadId: undefined }];
    if (!import.meta.client) return;
    const g = globalThis as any;
    if (g.__or3MultiPaneApi?.panes?.value) {
        g.__or3MultiPaneApi.panes.value = paneStub.value;
    }
    if (g.__or3MultiPaneApi?.activePaneIndex) {
        g.__or3MultiPaneApi.activePaneIndex.value = 0;
    }
}

async function resetEnvironment() {
    fetchQueue.length = 0;
    await resetDexie();
    resetPaneStub();
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
    predicate: () => boolean,
    options: { timeout?: number; interval?: number; message?: string } = {}
) {
    const timeout = options.timeout ?? 2000;
    const interval = options.interval ?? 25;
    const started = performance.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (predicate()) return;
        if (performance.now() - started > timeout) {
            throw new Error(options.message ?? 'waitFor timeout exceeded');
        }
        await delay(interval);
    }
}

function makeSseResponse(
    events: string[],
    signal?: AbortSignal,
    intervalMs = 10
) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let index = 0;
            let closed = false;
            const push = () => {
                if (closed) return;
                if (index >= events.length) {
                    controller.close();
                    return;
                }
                controller.enqueue(encoder.encode(events[index++]));
                if (intervalMs <= 0) push();
                else setTimeout(push, intervalMs);
            };
            push();
            signal?.addEventListener(
                'abort',
                () => {
                    closed = true;
                    controller.error(new DOMException('Aborted', 'AbortError'));
                },
                { once: true }
            );
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

function makeSseErrorResponse(
    events: string[],
    signal?: AbortSignal,
    intervalMs = 10
) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let index = 0;
            let closed = false;
            const push = () => {
                if (closed) return;
                if (index >= events.length) {
                    controller.error(new Error('Stream interrupted'));
                    return;
                }
                controller.enqueue(encoder.encode(events[index++]));
                if (intervalMs <= 0) push();
                else setTimeout(push, intervalMs);
            };
            push();
            signal?.addEventListener(
                'abort',
                () => {
                    closed = true;
                    controller.error(new DOMException('Aborted', 'AbortError'));
                },
                { once: true }
            );
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

function makeSlowAbortableStream(signal?: AbortSignal) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let closed = false;
            const interval = setInterval(() => {
                if (closed) return;
                controller.enqueue(
                    encoder.encode(
                        'data: {"choices":[{"delta":{"text":"..."}}]}' + '\n\n'
                    )
                );
            }, 40);
            signal?.addEventListener(
                'abort',
                () => {
                    closed = true;
                    clearInterval(interval);
                    controller.error(new DOMException('Aborted', 'AbortError'));
                },
                { once: true }
            );
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

const testDefinitions: TestDefinition[] = [
    {
        id: 'api-key-hydration',
        label: 'Hydrates OpenRouter key from Dexie',
        description:
            'Ensures useChat pulls the stored openrouter_api_key into reactive state before sending.',
        async run(ctx) {
            const now = nowSec();
            await db.kv.put({
                id: newId(),
                name: 'openrouter_api_key',
                value: 'sk-test-123',
                created_at: now,
                updated_at: now,
                clock: 0,
            });
            ctx.log('Seeded Dexie kv table with openrouter_api_key');
            const chat = useChat([]);
            await ctx.waitFor(
                () => state.value.openrouterKey === 'sk-test-123',
                {
                    timeout: 1500,
                    message: 'state.openrouterKey did not hydrate from Dexie',
                }
            );
            ctx.log(`Hydrated key: ${state.value.openrouterKey}`);
            assert(
                chat.messages.value.length === 0,
                'Initial messages should be empty'
            );
            assert(
                chat.tailAssistant.value === null,
                'Tail assistant should start null'
            );
        },
    },
    {
        id: 'streaming-success',
        label: 'Streams text and persists conversation',
        description:
            'Verifies model selection filter, outgoing/incoming hooks, pane binding, and Dexie persistence for user + assistant messages.',
        async run(ctx) {
            state.value.openrouterKey = 'sk-live';
            const deltaLog: string[] = [];
            const modelFilter = (model: string) => {
                deltaLog.push(`model:${model}`);
                return `${model}-stream`;
            };
            hooks.addFilter('ai.chat.model:filter:select', modelFilter as any);
            ctx.cleanup(() =>
                hooks.removeFilter(
                    'ai.chat.model:filter:select',
                    modelFilter as any
                )
            );

            const incomingFilter = (text: string) => `incoming:${text}`;
            hooks.addFilter(
                'ui.chat.message:filter:incoming',
                incomingFilter as any
            );
            ctx.cleanup(() =>
                hooks.removeFilter(
                    'ui.chat.message:filter:incoming',
                    incomingFilter as any
                )
            );

            const deltaAction = (delta: string) =>
                deltaLog.push(`delta:${delta}`);
            hooks.addAction('ai.chat.stream:action:delta', deltaAction as any);
            ctx.cleanup(() =>
                hooks.removeAction(
                    'ai.chat.stream:action:delta',
                    deltaAction as any
                )
            );

            const reasoningAction = (chunk: string) =>
                deltaLog.push(`reasoning:${chunk}`);
            hooks.addAction(
                'ai.chat.stream:action:reasoning',
                reasoningAction as any
            );
            ctx.cleanup(() =>
                hooks.removeAction(
                    'ai.chat.stream:action:reasoning',
                    reasoningAction as any
                )
            );

            const events = [
                'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"planning"}]}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"Hello"}}]}\n\n',
                'data: {"choices":[{"delta":{"text":" world"}}]}\n\n',
                'data: {"choices":[{"message":{"content":[{"type":"text","text":"Hello world"}]}}]}\n\n',
                'data: [DONE]\n\n',
            ];

            ctx.enqueueFetch(async (_input, init) => {
                const rawBody =
                    typeof init?.body === 'string' ? init.body : undefined;
                assert(rawBody, 'Expected JSON body for OpenRouter request');
                const parsed = JSON.parse(rawBody);
                assert(
                    parsed.model === 'openai/gpt-oss-120b-stream',
                    `Model filter not applied. Got ${parsed.model}`
                );
                assert(
                    Array.isArray(parsed.messages),
                    'messages missing in payload'
                );
                return makeSseResponse(events, init?.signal ?? undefined, 5);
            });

            const chat = useChat([]);
            await chat.sendMessage('Hello world');
            await ctx.waitFor(
                () =>
                    !chat.loading.value &&
                    chat.tailAssistant.value?.text === 'incoming:Hello world',
                {
                    timeout: 2000,
                    message: 'Assistant response did not finalize',
                }
            );
            await delay(50);

            assert(
                deltaLog.some((entry) => entry.startsWith('reasoning:')),
                'Reasoning action did not fire'
            );
            assert(
                deltaLog.filter((entry) => entry.startsWith('delta:')).length >=
                    2,
                'Expected multiple delta actions'
            );

            const threadId = chat.threadId.value;
            assert(threadId, 'Thread ID should be assigned after send');
            const g = globalThis as any;
            const paneThread = g.__or3MultiPaneApi?.panes?.value?.[0]?.threadId;
            assert(
                paneThread === threadId,
                'Active pane did not bind new thread'
            );

            const records = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .toArray();
            assert(
                records.length === 2,
                'Expected exactly 2 persisted messages'
            );
            const assistant = records.find((m) => m.role === 'assistant');
            const content = (assistant?.data as any)?.content;
            assert(
                content === 'incoming:Hello world',
                `Assistant content mismatch: ${content}`
            );
            ctx.log('Streaming + persistence verified');
        },
    },
    {
        id: 'retry-flow',
        label: 'Retry rewinds and resends user message',
        description:
            'Validates retryMessage removes prior pair, suppresses old tail assistant, and persists refreshed response.',
        async run(ctx) {
            state.value.openrouterKey = 'retry-key';
            const firstEvents = [
                'data: {"choices":[{"delta":{"text":"First attempt"}}]}\n\n',
                'data: [DONE]\n\n',
            ];
            const secondEvents = [
                'data: {"choices":[{"delta":{"text":"Second pass"}}]}\n\n',
                'data: [DONE]\n\n',
            ];

            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(firstEvents, init?.signal ?? undefined)
                )
            );
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(secondEvents, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('Please retry me');
            await ctx.waitFor(
                () =>
                    !chat.loading.value &&
                    Boolean(
                        chat.tailAssistant.value?.text?.includes(
                            'First attempt'
                        )
                    ),
                {
                    timeout: 1500,
                    message: 'First assistant response missing',
                }
            );
            const firstAssistantId = chat.tailAssistant.value?.id;
            const userId = chat.messages.value.find(
                (m) => m.role === 'user'
            )?.id;
            assert(userId, 'User message id missing for retry');

            await chat.retryMessage(userId!);
            await ctx.waitFor(
                () =>
                    !chat.loading.value &&
                    Boolean(
                        chat.tailAssistant.value?.text?.includes('Second pass')
                    ),
                {
                    timeout: 2000,
                    message: 'Retry assistant response missing',
                }
            );
            const secondAssistantId = chat.tailAssistant.value?.id;
            assert(
                firstAssistantId !== secondAssistantId,
                'Tail assistant id should change after retry'
            );
            const records = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .toArray();
            const assistant = records.find((m) => m.role === 'assistant');
            const userCount = records.filter((m) => m.role === 'user').length;
            assert(
                userCount === 1,
                'Only the fresh user message should persist'
            );
            assert(
                (assistant?.data as any)?.content?.includes('Second pass'),
                'Assistant content not updated after retry'
            );
            ctx.log('Retry successfully replaced previous message pair');
        },
    },
    {
        id: 'outgoing-filter-block',
        label: 'Outgoing filter veto prevents send',
        description:
            'Confirms that returning empty string from outgoing filter blocks persistence and network calls.',
        async run(ctx) {
            state.value.openrouterKey = 'filter-key';
            const outgoingFilter = () => '';
            hooks.addFilter(
                'ui.chat.message:filter:outgoing',
                outgoingFilter as any
            );
            ctx.cleanup(() =>
                hooks.removeFilter(
                    'ui.chat.message:filter:outgoing',
                    outgoingFilter as any
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('should be blocked');
            assert(
                chat.messages.value.length === 0,
                'No messages should be appended when outgoing filter vetoes'
            );
            assert(
                !chat.threadId.value,
                'Thread should not be created on veto'
            );
            const messageCount = await db.messages.count();
            assert(messageCount === 0, 'Dexie should remain empty when vetoed');
            ctx.log('Outgoing filter veto confirmed');
        },
    },
    {
        id: 'stream-error',
        label: 'Error path leaves user message intact',
        description:
            'Simulates OpenRouter failure and verifies user message persists, assistant placeholder removed, and error finalizes stream state.',
        async run(ctx) {
            state.value.openrouterKey = 'err-key';
            ctx.enqueueFetch(
                async () =>
                    new Response('error', {
                        status: 500,
                        statusText: 'Internal Server Error',
                    })
            );
            const chat = useChat([]);
            await chat.sendMessage('trigger error');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading flag did not reset after error',
            });
            const threadId = chat.threadId.value;
            assert(threadId, 'Thread should still exist after error');
            const records = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .toArray();
            assert(
                records.length === 1,
                'Only user message should persist on error'
            );
            const [userMessage] = records;
            assert(
                userMessage?.role === 'user',
                'Persisted message must be user'
            );
            const tail = chat.tailAssistant.value;
            assert(
                !tail || !tail.text,
                'Tail assistant should not contain text after stream error'
            );
            ctx.log('Error path preserved user message and cleared assistant');
        },
    },
    {
        id: 'stream-error-partial',
        label: 'Partial assistant persists on stream interruption',
        description:
            'Simulates mid-stream failure and verifies assistant text is retained with an error flag.',
        async run(ctx) {
            state.value.openrouterKey = 'partial-err-key';
            const events = [
                'data: {"choices":[{"delta":{"text":"Partial "}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"response"}}]}\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseErrorResponse(events, init?.signal ?? undefined)
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('trigger partial error');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading flag did not reset after stream error',
            });
            const threadId = chat.threadId.value;
            assert(threadId, 'Thread should still exist after error');
            const records = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .toArray();
            const userMessage = records.find((m) => m.role === 'user');
            const assistantMessage = records.find((m) => m.role === 'assistant');
            assert(userMessage, 'User message should persist on error');
            assert(assistantMessage, 'Assistant message should persist on error');
            assert(
                assistantMessage?.error === 'stream_interrupted',
                'Assistant message should be marked as interrupted'
            );
            const assistantText = assistantMessage
                ? deriveMessageContent({
                      content: (assistantMessage as { content?: string }).content,
                      data: assistantMessage.data,
                  })
                : '';
            assert(
                assistantText.includes('Partial response'),
                'Assistant text should include partial response'
            );
            ctx.log('Partial assistant preserved with error flag');
        },
    },
    {
        id: 'continue-flow',
        label: 'Continue appends into same assistant message',
        description:
            'Ensures continueMessage keeps the same assistant id, appends new text, and clears error.',
        async run(ctx) {
            state.value.openrouterKey = 'continue-key';
            const firstEvents = [
                'data: {"choices":[{"delta":{"text":"Partial"}}]}\n\n',
            ];
            const continueEvents = [
                'data: {"choices":[{"delta":{"text":" and done"}}]}\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseErrorResponse(firstEvents, init?.signal ?? undefined)
                )
            );
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(continueEvents, init?.signal ?? undefined)
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('continue me');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after initial error',
            });
            const threadId = chat.threadId.value;
            assert(threadId, 'Thread should exist after initial error');
            let records = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .toArray();
            const assistantBefore = records.find(
                (m) => m.role === 'assistant'
            );
            assert(assistantBefore, 'Assistant should exist after error');
            assert(
                assistantBefore?.error === 'stream_interrupted',
                'Assistant should be flagged as interrupted'
            );
            const textBefore = deriveMessageContent({
                content: (assistantBefore as { content?: string }).content,
                data: assistantBefore.data,
            });
            assert(
                textBefore.includes('Partial'),
                'Assistant should contain initial partial text'
            );
            const recordCount = records.length;

            await chat.continueMessage(assistantBefore.id, DEFAULT_AI_MODEL);
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after continue',
            });

            records = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .toArray();
            assert(
                records.length === recordCount,
                'Continue should not create new messages'
            );
            const assistantAfter = records.find(
                (m) => m.id === assistantBefore.id
            );
            assert(assistantAfter, 'Assistant should persist after continue');
            assert(
                assistantAfter?.error == null,
                'Assistant error should be cleared after continue'
            );
            const textAfter = deriveMessageContent({
                content: (assistantAfter as { content?: string }).content,
                data: assistantAfter.data,
            });
            assert(
                textAfter.includes('Partial') &&
                    textAfter.includes('and done'),
                'Assistant should include appended continuation text'
            );
            ctx.log('Continue appended text and cleared error');
        },
    },
    {
        id: 'continue-after-reload',
        label: 'Continue works after reload',
        description:
            'Reloads chat state and verifies continue can resume from persisted error state.',
        async run(ctx) {
            state.value.openrouterKey = 'reload-key';
            const firstEvents = [
                'data: {"choices":[{"delta":{"text":"Partial"}}]}\n\n',
            ];
            const continueEvents = [
                'data: {"choices":[{"delta":{"text":" reload"}}]}\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseErrorResponse(firstEvents, init?.signal ?? undefined)
                )
            );
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            ...continueEvents,
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('reload me');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after initial error',
            });
            const threadId = chat.threadId.value;
            assert(threadId, 'Thread should exist after error');
            const records = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .toArray();
            const assistant = records.find((m) => m.role === 'assistant');
            assert(assistant, 'Assistant should persist after error');
            assert(
                assistant?.error === 'stream_interrupted',
                'Assistant should be flagged as interrupted'
            );

            const reloaded = useChat([], threadId);
            await reloaded.ensureHistorySynced();
            const reloadedMessage = reloaded.messages.value.find(
                (m) => m.id === assistant!.id
            );
            assert(reloadedMessage, 'Reloaded message should be visible');
            assert(
                reloadedMessage?.error === 'stream_interrupted',
                'Reloaded message should retain error flag'
            );

            await reloaded.continueMessage(assistant.id, DEFAULT_AI_MODEL);
            await ctx.waitFor(() => !reloaded.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after continue',
            });

            const updated = await db.messages.get(assistant.id);
            assert(updated, 'Assistant should persist after continue');
            assert(
                updated?.error == null,
                'Assistant error should be cleared after continue'
            );
            const textAfter = deriveMessageContent({
                content: (updated as { content?: string }).content,
                data: updated?.data,
            });
            assert(
                textAfter.includes('Partial') &&
                    textAfter.includes('reload'),
                'Assistant should include appended continuation text'
            );
            ctx.log('Continue after reload succeeded');
        },
    },
    {
        id: 'continue-preserves-reasoning',
        label: 'Continue preserves reasoning text',
        description:
            'Ensures reasoning_text persists across interruption and continue.',
        async run(ctx) {
            state.value.openrouterKey = 'reasoning-continue-key';
            const firstEvents = [
                'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"Thinking..."}]}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"Hi"}}]}\n\n',
            ];
            const continueEvents = [
                'data: {"choices":[{"delta":{"text":" there"}}]}\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseErrorResponse(firstEvents, init?.signal ?? undefined)
                )
            );
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            ...continueEvents,
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('reasoning please');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after reasoning error',
            });
            const threadId = chat.threadId.value;
            assert(threadId, 'Thread should exist after reasoning error');
            const assistant = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .filter((m) => m.role === 'assistant')
                .first();
            assert(assistant, 'Assistant should persist after error');
            const reasoningBefore =
                assistant?.data &&
                typeof assistant.data === 'object' &&
                typeof (assistant.data as { reasoning_text?: unknown })
                    .reasoning_text === 'string'
                    ? ((assistant.data as { reasoning_text: string })
                          .reasoning_text as string)
                    : '';
            assert(
                reasoningBefore.includes('Thinking'),
                'Reasoning should be persisted on error'
            );

            await chat.continueMessage(assistant.id, DEFAULT_AI_MODEL);
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after continue',
            });
            const updated = await db.messages.get(assistant.id);
            assert(updated, 'Assistant should persist after continue');
            const reasoningAfter =
                updated?.data &&
                typeof updated.data === 'object' &&
                typeof (updated.data as { reasoning_text?: unknown })
                    .reasoning_text === 'string'
                    ? ((updated.data as { reasoning_text: string })
                          .reasoning_text as string)
                    : '';
            assert(
                reasoningAfter.includes('Thinking'),
                'Reasoning should be preserved after continue'
            );
            const textAfter = deriveMessageContent({
                content: (updated as { content?: string }).content,
                data: updated?.data,
            });
            assert(
                textAfter.includes('Hi') && textAfter.includes('there'),
                'Assistant should append continuation text'
            );
            ctx.log('Continue preserved reasoning text');
        },
    },
    {
        id: 'continue-keeps-image-hashes',
        label: 'Continue keeps image hashes without duplication',
        description:
            'Ensures image placeholders and hashes persist when continuing after an interruption.',
        async run(ctx) {
            state.value.openrouterKey = 'continue-image-key';
            const dataUrl =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
            const firstEvents = [
                'data: {"choices":[{"delta":{"text":"Image start"}}]}\n\n',
                `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${dataUrl}"}}]}}]}\n\n`,
            ];
            const continueEvents = [
                'data: {"choices":[{"delta":{"text":" done"}}]}\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseErrorResponse(firstEvents, init?.signal ?? undefined)
                )
            );
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            ...continueEvents,
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('image then continue');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after image error',
            });
            const threadId = chat.threadId.value;
            assert(threadId, 'Thread should exist after image error');
            const assistant = await db.messages
                .where('thread_id')
                .equals(threadId!)
                .filter((m) => m.role === 'assistant')
                .first();
            assert(assistant, 'Assistant should persist after error');
            assert(assistant?.file_hashes, 'Image hashes should persist');
            const hashesBefore = JSON.parse(assistant.file_hashes);
            assert(
                Array.isArray(hashesBefore) && hashesBefore.length === 1,
                'Expected one image hash before continue'
            );
            const textBefore = deriveMessageContent({
                content: (assistant as { content?: string }).content,
                data: assistant?.data,
            });
            const placeholderCountBefore =
                (textBefore.match(/!\[generated image]/g) || []).length;
            assert(
                placeholderCountBefore === 1,
                'Expected one image placeholder before continue'
            );

            await chat.continueMessage(assistant.id, DEFAULT_AI_MODEL);
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Loading did not reset after continue',
            });
            const updated = await db.messages.get(assistant.id);
            assert(updated, 'Assistant should persist after continue');
            assert(
                updated?.error == null,
                'Assistant error should be cleared after continue'
            );
            const hashesAfter = updated?.file_hashes
                ? JSON.parse(updated.file_hashes)
                : [];
            assert(
                Array.isArray(hashesAfter) && hashesAfter.length === 1,
                'Expected one image hash after continue'
            );
            const textAfter = deriveMessageContent({
                content: (updated as { content?: string }).content,
                data: updated?.data,
            });
            const placeholderCountAfter =
                (textAfter.match(/!\[generated image]/g) || []).length;
            assert(
                placeholderCountAfter === 1,
                'Expected one image placeholder after continue'
            );
            assert(
                textAfter.includes('done'),
                'Assistant should append continuation text'
            );
            ctx.log('Continue preserved image hashes and placeholders');
        },
    },
    {
        id: 'abort-flow',
        label: 'Abort cancels stream without assistant persistence',
        description:
            'Ensures abort() stops streaming, finalizes accumulator, and avoids assistant writes.',
        async run(ctx) {
            state.value.openrouterKey = 'abort-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSlowAbortableStream(init?.signal ?? undefined)
                )
            );
            const chat = useChat([]);
            const sendPromise = chat.sendMessage('abort me');
            await ctx.waitFor(() => chat.loading.value, {
                timeout: 500,
                message: 'Send did not enter loading state',
            });
            chat.abort();
            await sendPromise;
            await delay(80);

            const records = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .toArray();
            assert(
                records.filter((m) => m.role === 'assistant').length === 0,
                'Assistant message should not persist after abort'
            );
            const tail = chat.tailAssistant.value as UiChatMessage | null;
            if (tail) {
                assert(
                    !tail.pending,
                    'Tail assistant should not remain pending'
                );
                assert(
                    !tail.text,
                    'Tail assistant text should be empty after abort'
                );
            }
            ctx.log('Abort cleared stream without assistant persistence');
        },
    },
    {
        id: 'image-attachment',
        label: 'Image streaming stores attachment metadata',
        description:
            'Feeds an image delta and ensures createOrRefFile persists hashes and markdown placeholder is appended.',
        async run(ctx) {
            state.value.openrouterKey = 'img-key';
            const dataUrl =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
            const events = [
                'data: {"choices":[{"delta":{"text":"Generating image"}}]}\n\n',
                `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${dataUrl}"}}]}}]}\n\n`,
                'data: {"choices":[{"message":{"content":[{"type":"text","text":"Here you go"}]}}]}\n\n',
                'data: [DONE]\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );
            const chat = useChat([]);
            await chat.sendMessage('render image');
            await ctx.waitFor(
                () =>
                    !chat.loading.value &&
                    (chat.tailAssistant.value?.text || '').includes(
                        '![generated image]'
                    ),
                {
                    timeout: 2000,
                    message: 'Image placeholder missing from assistant text',
                }
            );
            await delay(80);
            const fileMetaCount = await db.file_meta.count();
            assert(
                fileMetaCount === 1,
                'Expected exactly one generated file meta'
            );
            const assistant = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .filter((m) => m.role === 'assistant')
                .first();
            assert(
                assistant?.file_hashes,
                'Assistant file hashes should be persisted'
            );
            ctx.log('Image stream persisted metadata + UI placeholder');
        },
    },
    {
        id: 'multiple-messages',
        label: 'Multiple message exchange maintains order',
        description:
            'Sends multiple user/assistant pairs and verifies message ordering and index integrity.',
        async run(ctx) {
            state.value.openrouterKey = 'multi-key';
            const exchanges = [
                { user: 'First question', assistant: 'First answer' },
                { user: 'Second question', assistant: 'Second answer' },
                { user: 'Third question', assistant: 'Third answer' },
            ];

            for (let i = 0; i < exchanges.length; i++) {
                const exchange = exchanges[i];
                if (!exchange) continue;
                const events = [
                    `data: {"choices":[{"delta":{"text":"${exchange.assistant}"}}]}\n\n`,
                    'data: [DONE]\n\n',
                ];
                ctx.enqueueFetch((_input, init) =>
                    Promise.resolve(
                        makeSseResponse(events, init?.signal ?? undefined)
                    )
                );
            }

            const chat = useChat([]);
            for (const exchange of exchanges) {
                await chat.sendMessage(exchange.user);
                await ctx.waitFor(
                    () =>
                        !chat.loading.value &&
                        Boolean(
                            chat.tailAssistant.value?.text?.includes(
                                exchange.assistant
                            )
                        ),
                    {
                        timeout: 1500,
                        message: `Exchange failed: ${exchange.user}`,
                    }
                );
                chat.flushTailAssistant();
            }

            const records = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .sortBy('index');

            assert(
                records.length === exchanges.length * 2,
                `Expected ${exchanges.length * 2} messages, got ${
                    records.length
                }`
            );

            for (let i = 0; i < exchanges.length; i++) {
                const userIdx = i * 2;
                const assistantIdx = userIdx + 1;
                const userRec = records[userIdx];
                const assistantRec = records[assistantIdx];
                assert(userRec, `User record ${userIdx} missing`);
                assert(
                    assistantRec,
                    `Assistant record ${assistantIdx} missing`
                );
                assert(
                    userRec.role === 'user',
                    `Message ${userIdx} should be user`
                );
                assert(
                    assistantRec.role === 'assistant',
                    `Message ${assistantIdx} should be assistant`
                );
                const exchange = exchanges[i];
                assert(exchange, `Exchange ${i} missing`);
                assert(
                    (userRec.data as any)?.content === exchange.user,
                    `User message ${i} content mismatch`
                );
                assert(
                    (assistantRec.data as any)?.content === exchange.assistant,
                    `Assistant message ${i} content mismatch`
                );
            }
            ctx.log('Multi-message ordering verified');
        },
    },
    {
        id: 'reasoning-persistence',
        label: 'Reasoning text persists separately',
        description:
            'Validates that reasoning_details stream events persist to reasoning_text field.',
        async run(ctx) {
            state.value.openrouterKey = 'reasoning-key';
            const events = [
                'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"Let me think..."}]}}]}\n\n',
                'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":" step by step"}]}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"Final answer"}}]}\n\n',
                'data: [DONE]\n\n',
            ];

            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('complex question');
            await ctx.waitFor(
                () =>
                    !chat.loading.value &&
                    chat.tailAssistant.value?.text === 'Final answer',
                { timeout: 1500, message: 'Assistant response missing' }
            );

            const assistant = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .filter((m) => m.role === 'assistant')
                .first();

            assert(assistant, 'Assistant message not found');
            const reasoningText = (assistant.data as any)?.reasoning_text;
            assert(
                reasoningText === 'Let me think... step by step',
                `Reasoning text mismatch: ${reasoningText}`
            );
            ctx.log('Reasoning text persisted correctly');
        },
    },
    {
        id: 'system-prompt-injection',
        label: 'System prompt injected into request',
        description:
            'Verifies system messages are prepended to conversation when system prompt is set.',
        async run(ctx) {
            state.value.openrouterKey = 'system-key';
            let capturedMessages: any[] = [];

            ctx.enqueueFetch(async (_input, init) => {
                const rawBody =
                    typeof init?.body === 'string' ? init.body : undefined;
                if (rawBody) {
                    const parsed = JSON.parse(rawBody);
                    capturedMessages = parsed.messages || [];
                }
                return makeSseResponse(
                    [
                        'data: {"choices":[{"delta":{"text":"ok"}}]}\n\n',
                        'data: [DONE]\n\n',
                    ],
                    init?.signal ?? undefined
                );
            });

            // Create thread with system prompt
            const now = nowSec();
            const promptId = newId();
            // Content must be TipTap JSON format
            const tiptapContent = JSON.stringify({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'You are a helpful assistant.',
                            },
                        ],
                    },
                ],
            });
            await db.posts.put({
                id: promptId,
                title: 'Test Prompt',
                content: tiptapContent,
                postType: 'prompt',
                created_at: now,
                updated_at: now,
                deleted: false,
                meta: '[]',
            });

            const threadId = newId();
            await db.threads.put({
                id: threadId,
                title: 'Test Thread',
                created_at: now,
                updated_at: now,
                last_message_at: now,
                status: 'ready',
                deleted: false,
                pinned: false,
                clock: 0,
                forked: false,
                system_prompt_id: promptId,
            });

            const chat = useChat([], threadId);
            await chat.sendMessage('Hello');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Send did not complete',
            });

            assert(
                capturedMessages.length >= 2,
                `Expected at least 2 messages, got ${capturedMessages.length}`
            );
            const systemMsg = capturedMessages.find((m) => m.role === 'system');
            assert(systemMsg, 'System message not injected');

            // System content might be string or object with content field
            let systemContent = '';
            if (typeof systemMsg.content === 'string') {
                systemContent = systemMsg.content;
            } else if (
                systemMsg.content &&
                typeof systemMsg.content === 'object'
            ) {
                // Handle content parts array or nested content
                if (Array.isArray(systemMsg.content)) {
                    systemContent = systemMsg.content
                        .map((part: any) => {
                            if (typeof part === 'string') return part;
                            if (part.type === 'text') return part.text || '';
                            return '';
                        })
                        .join('');
                } else if (systemMsg.content.text) {
                    systemContent = systemMsg.content.text;
                } else {
                    systemContent = JSON.stringify(systemMsg.content);
                }
            }

            ctx.log(`System message content: "${systemContent}"`);
            assert(
                systemContent.toLowerCase().includes('helpful assistant'),
                `System prompt content missing. Got: "${systemContent}"`
            );
            ctx.log('System prompt injection verified');
        },
    },
    {
        id: 'file-hash-persistence',
        label: 'User file hashes persist with message',
        description:
            'Sends message with file_hashes and verifies they persist alongside user message.',
        async run(ctx) {
            state.value.openrouterKey = 'hash-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"got it"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );

            const chat = useChat([]);
            const testHashes = ['abc123', 'def456', 'ghi789'];
            await chat.sendMessage('check these files', {
                file_hashes: testHashes,
                files: [],
                model: DEFAULT_AI_MODEL,
                online: false,
            });

            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Send did not complete',
            });

            const userMsg = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .filter((m) => m.role === 'user')
                .first();

            assert(userMsg?.file_hashes, 'User message file_hashes missing');
            const parsed = JSON.parse(userMsg.file_hashes);
            assert(
                Array.isArray(parsed) && parsed.length === 3,
                'File hashes not preserved'
            );
            ctx.log('User file hashes persisted correctly');
        },
    },
    {
        id: 'clear-memory',
        label: 'Clear frees in-memory messages',
        description:
            'Validates that clear() removes all in-memory message refs without deleting DB records.',
        async run(ctx) {
            state.value.openrouterKey = 'clear-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"response"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('test clear');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Send did not complete',
            });

            chat.flushTailAssistant();
            const preLength = chat.messages.value.length;
            assert(preLength === 2, 'Expected 2 messages before clear');

            const threadId = chat.threadId.value!;
            chat.clear();

            // Use relaxed comparison since clear() resets to empty
            const postLength = chat.messages.value.length;
            assert(postLength === 0, 'Messages not cleared from memory');
            assert(
                chat.tailAssistant.value === null,
                'Tail assistant not cleared'
            );

            const dbRecords = await db.messages
                .where('thread_id')
                .equals(threadId)
                .toArray();
            assert(
                dbRecords.length === 2,
                'DB records should remain after clear()'
            );
            ctx.log('Clear freed memory without deleting DB records');
        },
    },
    {
        id: 'model-override',
        label: 'Model parameter overrides default',
        description:
            'Ensures explicitly passed model parameter is used instead of defaults.',
        async run(ctx) {
            state.value.openrouterKey = 'model-key';
            let capturedModel = '';

            ctx.enqueueFetch(async (_input, init) => {
                const rawBody =
                    typeof init?.body === 'string' ? init.body : undefined;
                if (rawBody) {
                    const parsed = JSON.parse(rawBody);
                    capturedModel = parsed.model || '';
                }
                return makeSseResponse(
                    [
                        'data: {"choices":[{"delta":{"text":"ok"}}]}\n\n',
                        'data: [DONE]\n\n',
                    ],
                    init?.signal ?? undefined
                );
            });

            const chat = useChat([]);
            const customModel = 'anthropic/claude-3.5-sonnet';
            await chat.sendMessage('test', {
                model: customModel,
                files: [],
                file_hashes: [],
                online: false,
            });

            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Send did not complete',
            });

            assert(
                capturedModel === customModel,
                `Expected ${customModel}, got ${capturedModel}`
            );
            ctx.log('Model override respected');
        },
    },
    {
        id: 'online-suffix',
        label: 'Online mode appends :online suffix',
        description:
            'Validates that online:true adds :online to model ID in request.',
        async run(ctx) {
            state.value.openrouterKey = 'online-key';
            let capturedModel = '';

            ctx.enqueueFetch(async (_input, init) => {
                const rawBody =
                    typeof init?.body === 'string' ? init.body : undefined;
                if (rawBody) {
                    const parsed = JSON.parse(rawBody);
                    capturedModel = parsed.model || '';
                }
                return makeSseResponse(
                    [
                        'data: {"choices":[{"delta":{"text":"ok"}}]}\n\n',
                        'data: [DONE]\n\n',
                    ],
                    init?.signal ?? undefined
                );
            });

            const chat = useChat([]);
            await chat.sendMessage('search query', {
                model: 'openai/gpt-4o',
                online: true,
                files: [],
                file_hashes: [],
            });

            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 1500,
                message: 'Send did not complete',
            });

            assert(
                capturedModel === 'openai/gpt-4o:online',
                `Expected openai/gpt-4o:online, got ${capturedModel}`
            );
            ctx.log('Online suffix appended correctly');
        },
    },
    {
        id: 'thread-reuse',
        label: 'Existing thread ID reused across sends',
        description:
            'Verifies that second message uses same thread without creating new one.',
        async run(ctx) {
            state.value.openrouterKey = 'reuse-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"first"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"second"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('msg 1');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 1500 });
            const threadId1 = chat.threadId.value;

            chat.flushTailAssistant();

            await chat.sendMessage('msg 2');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 1500 });
            const threadId2 = chat.threadId.value;

            assert(threadId1 === threadId2, 'Thread ID changed unexpectedly');
            const threadCount = await db.threads.count();
            assert(
                threadCount === 1,
                'Multiple threads created instead of one'
            );
            ctx.log('Thread reused correctly across messages');
        },
    },
    {
        id: 'tail-assistant-isolation',
        label: 'Tail assistant not in messages until flushed',
        description:
            'Confirms tailAssistant stays separate from messages array until explicitly flushed.',
        async run(ctx) {
            state.value.openrouterKey = 'tail-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"tail test"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('check tail');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 1500 });

            const preFlushLength = chat.messages.value.length;
            assert(
                preFlushLength === 1,
                'Only user message should be in messages array'
            );
            const firstMsg = chat.messages.value[0];
            assert(firstMsg, 'First message missing');
            assert(firstMsg.role === 'user', 'Only message should be user');
            assert(
                chat.tailAssistant.value?.text === 'tail test',
                'Tail assistant missing response'
            );

            chat.flushTailAssistant();

            // After flush, check we have exactly 2 messages
            const postFlushLength = chat.messages.value.length;
            assert(
                postFlushLength === 2,
                'Messages array should have 2 after flush'
            );
            const secondMsg = chat.messages.value[1];
            assert(secondMsg, 'Second message missing after flush');
            assert(
                secondMsg.role === 'assistant',
                'Second message should be assistant after flush'
            );
            assert(
                chat.tailAssistant.value === null,
                'Tail assistant should be null after flush'
            );
            ctx.log('Tail assistant isolation verified');
        },
    },
    {
        id: 'stream-state-finalization',
        label: 'Stream state finalizes on completion',
        description:
            'Ensures streamState.finalized becomes true and isActive false after stream ends.',
        async run(ctx) {
            state.value.openrouterKey = 'state-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"done"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );

            const chat = useChat([]);
            assert(
                chat.streamState.finalized === false,
                'Stream should start unfinalized'
            );

            await chat.sendMessage('finalize test');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 1500 });

            // Wait for stream to fully finalize (finalize() is called after persistence)
            await ctx.waitFor(() => chat.streamState.finalized, {
                timeout: 500,
                message: 'Stream did not finalize',
            });

            // Check finalized state
            assert(chat.streamState.finalized, 'Stream should be finalized');
            assert(
                chat.streamState.isActive === false,
                'Stream should be inactive'
            );
            assert(
                chat.streamState.error === null,
                'No error should be present'
            );
            ctx.log('Stream state finalization verified');
        },
    },
    {
        id: 'no-api-key-noop',
        label: 'Missing API key prevents send',
        description:
            'Validates that sendMessage returns early when apiKey is not set.',
        async run(ctx) {
            const originalKey = state.value.openrouterKey;
            state.value.openrouterKey = null;

            const chat = useChat([]);
            await chat.sendMessage('should not send');

            assert(
                chat.messages.value.length === 0,
                'No messages should be created'
            );
            assert(!chat.threadId.value, 'No thread should be created');
            const messageCount = await db.messages.count();
            assert(messageCount === 0, 'DB should remain empty');

            state.value.openrouterKey = originalKey;
            ctx.log('API key guard working correctly');
        },
    },
    {
        id: 'double-abort-safe',
        label: 'Multiple abort calls are safe',
        description:
            'Ensures calling abort() multiple times does not throw or create issues.',
        async run(ctx) {
            state.value.openrouterKey = 'abort2-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSlowAbortableStream(init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            const sendPromise = chat.sendMessage('abort test');
            await ctx.waitFor(() => chat.loading.value, { timeout: 500 });

            chat.abort();
            chat.abort(); // Second abort should be safe
            chat.abort(); // Third abort should be safe

            await sendPromise;
            await delay(50);

            assert(!chat.loading.value, 'Loading should be false after abort');
            ctx.log('Multiple abort calls handled safely');
        },
    },
    {
        id: 'initial-messages-hydration',
        label: 'Initial messages passed to useChat hydrate correctly',
        description:
            'Verifies that passing existing messages to useChat initializes state properly.',
        async run(ctx) {
            const existingMessages: ChatMessage[] = [
                {
                    id: newId(),
                    role: 'user',
                    content: 'Hello',
                },
                {
                    id: newId(),
                    role: 'assistant',
                    content: 'Hi there',
                },
            ];

            const chat = useChat(existingMessages);

            assert(
                chat.messages.value.length === 2,
                'Initial messages not hydrated'
            );
            const msg0 = chat.messages.value[0];
            const msg1 = chat.messages.value[1];
            assert(msg0, 'First message missing');
            assert(msg1, 'Second message missing');
            assert(msg0.role === 'user', 'First message should be user');
            assert(
                msg1.role === 'assistant',
                'Second message should be assistant'
            );
            assert(msg0.text === 'Hello', 'User text mismatch');
            assert(msg1.text === 'Hi there', 'Assistant text mismatch');
            ctx.log('Initial messages hydrated correctly');
        },
    },
    {
        id: 'stream-reset',
        label: 'resetStream clears stream state',
        description:
            'Validates that resetStream() clears streamId and resets accumulator.',
        async run(ctx) {
            state.value.openrouterKey = 'reset-key';
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(
                        [
                            'data: {"choices":[{"delta":{"text":"test"}}]}\n\n',
                            'data: [DONE]\n\n',
                        ],
                        init?.signal ?? undefined
                    )
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('test');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 1500 });

            const streamIdBefore = chat.streamId.value;
            assert(streamIdBefore, 'Stream ID should exist after send');

            chat.resetStream();

            assert(
                chat.streamId.value === undefined,
                'Stream ID should be cleared'
            );
            assert(chat.streamState.text === '', 'Stream text should be empty');
            assert(
                chat.streamState.reasoningText === '',
                'Reasoning text should be empty'
            );
            ctx.log('Stream reset completed successfully');
        },
    },
    {
        id: 'image-dedupe',
        label: 'Duplicate images only persist once',
        description:
            'Sends the same data URL twice and verifies markdown placeholder is not duplicated, file_meta/file_hashes dedupe works.',
        async run(ctx) {
            state.value.openrouterKey = 'dedupe-key';
            const dataUrl =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
            const events = [
                'data: {"choices":[{"delta":{"text":"Image 1"}}]}\n\n',
                `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${dataUrl}"}}]}}]}\n\n`,
                'data: {"choices":[{"delta":{"text":" and 2"}}]}\n\n',
                `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${dataUrl}"}}]}}]}\n\n`,
                'data: [DONE]\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('test dedupe');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 2000 });
            await delay(100);

            const text = chat.tailAssistant.value?.text || '';
            const placeholderCount = (text.match(/!\[generated image\]/g) || [])
                .length;
            // Current implementation dedupes placeholders by URL - both images have same URL
            // so only 1 placeholder should appear (this is the actual behavior)
            assert(
                placeholderCount === 1,
                `Expected 1 placeholder (deduped by URL), got ${placeholderCount}`
            );

            const fileMetaCount = await db.file_meta.count();
            assert(
                fileMetaCount === 1,
                `Expected 1 file_meta (deduped), got ${fileMetaCount}`
            );

            const assistant = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .filter((m) => m.role === 'assistant')
                .first();
            if (assistant?.file_hashes) {
                const hashes = JSON.parse(assistant.file_hashes);
                assert(
                    hashes.length === 1,
                    `Expected 1 unique hash, got ${hashes.length}`
                );
            }
            ctx.log('Image deduplication verified');
        },
    },
    {
        id: 'image-limit',
        label: 'Image limit caps at 6 hashes',
        description:
            'Sends >6 images and verifies only 6 hashes persist but all placeholders appear.',
        async run(ctx) {
            state.value.openrouterKey = 'limit-key';
            const dataUrl =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
            // Generate unique data URLs by appending index
            const events: string[] = [];
            for (let i = 0; i < 8; i++) {
                const uniqueUrl = dataUrl + `?i=${i}`;
                events.push(
                    `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${uniqueUrl}"}}]}}]}\n\n`
                );
            }
            events.push('data: [DONE]\n\n');

            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('many images');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 2500 });
            await delay(150);

            const text = chat.tailAssistant.value?.text || '';
            const placeholderCount = (text.match(/!\[generated image\]/g) || [])
                .length;
            assert(
                placeholderCount === 8,
                `Expected 8 placeholders, got ${placeholderCount}`
            );

            const assistant = await db.messages
                .where('thread_id')
                .equals(chat.threadId.value!)
                .filter((m) => m.role === 'assistant')
                .first();
            if (assistant?.file_hashes) {
                const hashes = JSON.parse(assistant.file_hashes);
                assert(
                    hashes.length === 6,
                    `Expected max 6 hashes, got ${hashes.length}`
                );
            }
            ctx.log('Image limit cap verified');
        },
    },
    {
        id: 'image-fetch-failure',
        label: 'Remote image fetch failure handled gracefully',
        description:
            'Uses non-200 URL and verifies no crash, no hash persisted, placeholder still present.',
        async run(ctx) {
            state.value.openrouterKey = 'fetch-fail-key';
            const badUrl = 'https://example.com/nonexistent.png';
            const events = [
                'data: {"choices":[{"delta":{"text":"Failed image"}}]}\n\n',
                `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${badUrl}"}}]}}]}\n\n`,
                'data: [DONE]\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('bad image url');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 2000 });
            await delay(100);

            const text = chat.tailAssistant.value?.text || '';
            assert(
                text.includes('![generated image]'),
                'Placeholder should be present despite fetch failure'
            );

            const fileMetaCount = await db.file_meta.count();
            assert(
                fileMetaCount === 0,
                `Expected 0 file_meta on fetch fail, got ${fileMetaCount}`
            );
            ctx.log('Remote image fetch failure handled');
        },
    },
    {
        id: 'outgoing-filter-whitespace',
        label: 'Outgoing filter whitespace veto',
        description:
            'Returns only whitespace from outgoing filter and verifies send is blocked.',
        async run(ctx) {
            state.value.openrouterKey = 'whitespace-key';
            const whitespaceFilter = () => '   \n\t  ';
            hooks.addFilter(
                'ui.chat.message:filter:outgoing',
                whitespaceFilter as any
            );
            ctx.cleanup(() =>
                hooks.removeFilter(
                    'ui.chat.message:filter:outgoing',
                    whitespaceFilter as any
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('should be trimmed and blocked');

            assert(
                chat.messages.value.length === 0,
                'No messages should be created for whitespace-only filter result'
            );
            assert(!chat.threadId.value, 'No thread should be created');
            const messageCount = await db.messages.count();
            assert(messageCount === 0, 'DB should remain empty');
            ctx.log('Whitespace filter veto confirmed');
        },
    },
    {
        id: 'filter-throws',
        label: 'Filter exception handled gracefully',
        description:
            'Incoming filter throws and verifies error path handles it without zombie loading.',
        async run(ctx) {
            state.value.openrouterKey = 'throw-key';
            const throwingFilter = () => {
                throw new Error('Filter intentionally threw');
            };
            hooks.addFilter(
                'ui.chat.message:filter:incoming',
                throwingFilter as any
            );
            ctx.cleanup(() =>
                hooks.removeFilter(
                    'ui.chat.message:filter:incoming',
                    throwingFilter as any
                )
            );

            const events = [
                'data: {"choices":[{"delta":{"text":"test"}}]}\n\n',
                'data: [DONE]\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('trigger filter error');
            await ctx.waitFor(() => !chat.loading.value, {
                timeout: 2000,
                message: 'Loading should reset after filter error',
            });

            assert(
                !chat.loading.value,
                'Loading flag should be false after error'
            );
            assert(
                chat.streamState.error !== null,
                'Stream state should contain error'
            );
            ctx.log('Filter exception handled gracefully');
        },
    },
    {
        id: 'action-ordering',
        label: 'Delta action ordering preserved',
        description:
            'Captures chunkIndex from delta actions and verifies monotonic increase.',
        async run(ctx) {
            state.value.openrouterKey = 'ordering-key';
            const capturedIndexes: number[] = [];
            const deltaAction = (_delta: string, meta?: any) => {
                if (meta?.chunkIndex !== undefined) {
                    capturedIndexes.push(meta.chunkIndex);
                }
            };
            hooks.addAction('ai.chat.stream:action:delta', deltaAction as any);
            ctx.cleanup(() =>
                hooks.removeAction(
                    'ai.chat.stream:action:delta',
                    deltaAction as any
                )
            );

            const events = [
                'data: {"choices":[{"delta":{"text":"A"}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"B"}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"C"}}]}\n\n',
                'data: {"choices":[{"delta":{"text":"D"}}]}\n\n',
                'data: [DONE]\n\n',
            ];
            ctx.enqueueFetch((_input, init) =>
                Promise.resolve(
                    makeSseResponse(events, init?.signal ?? undefined)
                )
            );

            const chat = useChat([]);
            await chat.sendMessage('ordering test');
            await ctx.waitFor(() => !chat.loading.value, { timeout: 1500 });
            await delay(50);

            assert(
                capturedIndexes.length >= 4,
                `Expected at least 4 delta actions, got ${capturedIndexes.length}`
            );
            for (let i = 1; i < capturedIndexes.length; i++) {
                const prev = capturedIndexes[i - 1];
                const curr = capturedIndexes[i];
                assert(
                    curr !== undefined && prev !== undefined && curr > prev,
                    `chunkIndex not monotonic: ${prev} -> ${curr}`
                );
            }
            ctx.log(
                `Delta action ordering verified: [${capturedIndexes.join(
                    ', '
                )}]`
            );
        },
    },
];

results.value = testDefinitions.map(createTestResult);

async function runTests() {
    if (running.value) return;
    running.value = true;
    results.value = testDefinitions.map(createTestResult);

    await ensureApiKey();

    for (const result of results.value) {
        const cleanups: Array<() => void | Promise<void>> = [];
        const ctx: TestRunContext = {
            log: (message) => result.logs.push(message),
            cleanup: (fn) => cleanups.push(fn),
            reset: resetEnvironment,
            enqueueFetch,
            waitFor,
        };
        try {
            await resetEnvironment();
            await result.run(ctx);
            result.status = 'pass';
        } catch (error) {
            result.status = 'fail';
            const err = error as Error;
            result.error = err.message ?? String(error);
            result.stack = err.stack;
        } finally {
            for (const cleanupFn of cleanups.reverse()) {
                try {
                    await cleanupFn();
                } catch (cleanupError) {
                    result.logs.push(
                        `cleanup failed: ${(cleanupError as Error).message}`
                    );
                }
            }
            fetchQueue.length = 0;
        }
    }

    running.value = false;
}

onMounted(() => {
    if (import.meta.client) installFetchStub();
});

onUnmounted(() => {
    fetchQueue.length = 0;
    uninstallFetchStub();
});
</script>
