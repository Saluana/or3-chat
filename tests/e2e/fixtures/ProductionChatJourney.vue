<template>
    <main
        class="h-dvh min-h-0"
        data-testid="production-chat-journey"
    >
        <span class="sr-only" data-testid="chat-journey-thread-id">
            {{ threadId || 'new-thread' }}
        </span>
        <ChatContainer
            v-if="ready"
            :thread-id="threadId || undefined"
            :message-history="messageHistory"
            pane-id="production-chat-journey"
            @thread-selected="rememberThread"
        />
    </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { messagesByThread } from '~/db/messages';
import type { ChatMessage } from '~/utils/chat/types';
import {
    projectTranscriptForOpenRouter,
    storedMessagesToCanonicalTranscript,
} from '~/utils/chat/transcript';

const THREAD_KEY = 'or3:e2e:production-chat-thread';
const TEST_API_KEY = 'sk-or-v1-production-journey-test-key';

const ready = ref(false);
const threadId = ref('');
const messageHistory = ref<ChatMessage[]>([]);
const attemptsByPrompt = new Map<string, number>();
const encoder = new TextEncoder();
let restoreFetch: (() => void) | undefined;

function messageText(message: unknown): string {
    if (!message || typeof message !== 'object') return '';
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(
            (part): part is { type: string; text?: string } =>
                Boolean(part) &&
                typeof part === 'object' &&
                (part as { type?: unknown }).type === 'text'
        )
        .map((part) => part.text ?? '')
        .join('');
}

function sseChunk(content: string): Uint8Array {
    return encoder.encode(
        `data: ${JSON.stringify({
            choices: [{ delta: { content }, finish_reason: null }],
        })}\n\n`
    );
}

function sseError(message: string): Uint8Array {
    return encoder.encode(
        `data: ${JSON.stringify({
            error: { message, status: 400, code: 'deterministic_failure' },
        })}\n\n`
    );
}

function requestUrl(input: RequestInfo | URL): string {
    if (input instanceof Request) return input.url;
    return String(input);
}

async function requestBody(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Record<string, unknown>> {
    const raw =
        typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : '';
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function installDeterministicFetch(): void {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        if (requestUrl(input).includes('/api/__or3-e2e/models')) {
            return Response.json({ data: [] });
        }
        if (!requestUrl(input).includes('/api/__or3-e2e/chat/completions')) {
            return originalFetch(input, init);
        }

        const body = await requestBody(input, init);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const prompt = [...messages]
            .reverse()
            .find(
                (message) =>
                    Boolean(message) &&
                    typeof message === 'object' &&
                    (message as { role?: unknown }).role === 'user'
            );
        const text = messageText(prompt);
        const attempt = (attemptsByPrompt.get(text) ?? 0) + 1;
        attemptsByPrompt.set(text, attempt);
        const signal =
            init?.signal ?? (input instanceof Request ? input.signal : null);

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                let stopped = false;
                const abort = () => {
                    stopped = true;
                    try {
                        controller.error(
                            signal?.reason ??
                                new DOMException('Aborted', 'AbortError')
                        );
                    } catch {}
                };
                signal?.addEventListener('abort', abort, { once: true });
                const enqueue = (chunk: Uint8Array) => {
                    if (!stopped) controller.enqueue(chunk);
                };
                const delay = (ms: number) =>
                    new Promise((resolve) => setTimeout(resolve, ms));

                try {
                    if (text.includes('journey:stop')) {
                        enqueue(sseChunk('Partial response before stop.'));
                        await delay(1_200);
                        enqueue(sseChunk(' Late response that must be ignored.'));
                    } else if (
                        text.includes('journey:error') &&
                        attempt === 1
                    ) {
                        enqueue(sseChunk('Partial response before failure.'));
                        await delay(800);
                        enqueue(sseError('Deterministic provider failure'));
                    } else if (text.includes('journey:error')) {
                        enqueue(sseChunk('Recovered '));
                        await delay(120);
                        enqueue(sseChunk('after retry.'));
                    } else {
                        enqueue(sseChunk('Hello '));
                        await delay(800);
                        enqueue(sseChunk('from deterministic stream.'));
                    }
                    enqueue(encoder.encode('data: [DONE]\n\n'));
                    if (!stopped) controller.close();
                } catch (error) {
                    if (!stopped) controller.error(error);
                } finally {
                    signal?.removeEventListener('abort', abort);
                }
            },
        });

        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
            },
        });
    };
    restoreFetch = () => {
        globalThis.fetch = originalFetch;
    };
}

function rememberThread(id: string) {
    threadId.value = id;
    localStorage.setItem(THREAD_KEY, id);
}

onMounted(async () => {
    installDeterministicFetch();
    localStorage.setItem(
        'or3:server-route-available',
        JSON.stringify({ available: false, timestamp: Date.now() })
    );
    threadId.value = localStorage.getItem(THREAD_KEY) ?? '';
    if (threadId.value) {
        const stored = await messagesByThread(threadId.value);
        messageHistory.value = projectTranscriptForOpenRouter(
            storedMessagesToCanonicalTranscript(stored)
        );
    }
    await persistUserApiKey(TEST_API_KEY);
    ready.value = true;
});

onBeforeUnmount(() => {
    restoreFetch?.();
});
</script>
