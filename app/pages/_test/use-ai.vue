<template>
    <div class="min-h-[100dvh] py-8 px-4">
        <div class="max-w-5xl mx-auto space-y-6">
            <section class="space-y-3">
                <header class="space-y-2">
                    <h1
                        class="font-['Press_Start_2P'] text-[18px] uppercase tracking-[0.2em]"
                    >
                        useChat Frontend Test Bench
                    </h1>
                    <p class="text-[17px] opacity-80 max-w-3xl">
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
                        class="retro-btn"
                        :loading="running"
                        :disabled="running"
                        @click="runTests"
                    >
                        Run all tests
                    </UButton>
                    <div
                        class="border-2 border-[var(--md-inverse-surface)] rounded-[3px] retro-shadow bg-[var(--md-inverse-surface)]/5 px-4 py-3 flex items-center gap-4 text-[15px]"
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
                    class="border-2 border-[var(--md-inverse-surface)] rounded-[3px] retro-shadow bg-[var(--md-inverse-surface)]/5 p-4 space-y-3"
                >
                    <header class="flex items-start justify-between gap-3">
                        <div class="space-y-1">
                            <h2
                                class="font-['Press_Start_2P'] text-[13px] uppercase tracking-[0.18em] leading-tight"
                            >
                                {{ result.label }}
                            </h2>
                            <p class="text-[15px] opacity-80">
                                {{ result.description }}
                            </p>
                        </div>
                        <div
                            class="flex items-center gap-1 text-[15px] font-mono"
                            :class="statusColors[result.status]"
                        >
                            <UIcon
                                v-if="result.status === 'pass'"
                                name="pixelarticons:check"
                                class="w-4 h-4"
                            />
                            <UIcon
                                v-else-if="result.status === 'fail'"
                                name="pixelarticons:close"
                                class="w-4 h-4"
                            />
                            <UIcon
                                v-else
                                name="pixelarticons:hourglass"
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
                        class="border border-red-500/60 bg-red-500/10 text-red-400 text-[14px] px-3 py-2 rounded-[3px] whitespace-pre-wrap"
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
import { useHead } from '#imports';
import { useChat } from '~/composables/chat/useAi';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { db } from '~/db';
import { state } from '~/state/global';
import { nowSec, newId } from '~/db/util';
import { useHooks } from '~/core/hooks/useHooks';

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
        if (url.includes('openrouter.ai/api/v1/chat/completions')) {
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
    state.value.openrouterKey = null;
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
];

results.value = testDefinitions.map(createTestResult);

async function runTests() {
    if (running.value) return;
    running.value = true;
    results.value = testDefinitions.map(createTestResult);

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
