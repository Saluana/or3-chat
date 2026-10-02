<template>
    <main
        class="h-dvh min-h-0"
        data-testid="production-chat-journey"
    >
        <span class="sr-only" data-testid="chat-journey-thread-id">
            {{ threadId || 'new-thread' }}
        </span>
        <PageShell v-if="ready && workspaceJourney" />
        <ChatContainer
            v-else-if="ready"
            :thread-id="threadId || undefined"
            :message-history="messageHistory"
            pane-id="production-chat-journey"
            @thread-selected="rememberThread"
        />
    </main>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from '#imports';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { useHooks } from '~/core/hooks/useHooks';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import type { ChatMessage } from '~/utils/chat/types';
import { createDocument, getDocument } from '~/db/documents';

const PageShell = defineAsyncComponent(() => import('~/components/PageShell.vue'));
const workspaceJourney = useRoute().query.workspace === '1';

const THREAD_KEY = 'or3:e2e:production-chat-thread';
const TEST_API_KEY = 'sk-or-v1-production-journey-test-key';

const ready = ref(false);
const threadId = ref('');
const messageHistory = ref<ChatMessage[]>([]);
const attemptsByPrompt = new Map<string, number>();
const hooks = useHooks();
const pauseAdmission = async (text: string) => {
    if (text.includes('journey:admission-stop'))
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    return text;
};
const emptyInput = (request: { messages: unknown[] }) => {
    const prompt = [...request.messages].reverse().find((message) =>
        message && typeof message === 'object' && (message as { role?: unknown }).role === 'user'
    );
    if (messageText(prompt).includes('journey:empty'))
        return { ...request, messages: [] };
    return request;
};
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
            return Response.json({ data: [], links: { next: null }, total_count: 0 });
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
                    if (text.includes('journey:workspace-find') || text.includes('journey:workspace-create') || text.includes('journey:workspace-edit')) {
                        const userIndex = messages.findLastIndex((message) => message && typeof message === 'object' && (message as { role?: unknown }).role === 'user');
                        const replies = messages.slice(userIndex + 1).filter((message) => message && typeof message === 'object' && (message as { role?: unknown }).role === 'tool');
                        const readReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_read');
                        const createReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_create_document');
                        const proposalReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_propose_document_edit');
                        const searchReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_search');
                        let name: string;
                        let args: Record<string, unknown>;
                        if (proposalReply || createReply || readReply && !text.includes('journey:workspace-edit')) {
                            const receipt = JSON.parse(messageText(proposalReply ?? readReply ?? createReply)) as { content?: string; error?: string };
                            enqueue(sseChunk(receipt.error ? `Workspace action failed: ${receipt.error}`
                                : proposalReply ? 'Workspace edit staged for review.' : readReply ? `Verified workspace evidence: ${receipt.content ?? ''}` : 'Native workspace document saved.'));
                            enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
                        } else if (readReply) {
                            const receipt = JSON.parse(messageText(readReply)) as { readId?: string; source?: { id: string }; blocks?: Array<{ ref?: string | null }> };
                            name = 'workspace_propose_document_edit';
                            args = { documentId: receipt.source?.id, readId: receipt.readId, operations: [{ kind: 'replace_block', ref: receipt.blocks?.[0]?.ref, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The saffron decision now includes review and recovery.' }] }] }] };
                        } else if (text.includes('journey:workspace-create')) {
                            name = 'workspace_create_document';
                            args = { title: 'Workspace saved result', content: { type: 'doc', content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Durable saffron result from chat.' }] },
                            ] } };
                        } else if (searchReply) {
                            const receipt = JSON.parse(messageText(searchReply)) as { results?: Array<{ source: { kind: string; id: string } }> };
                            const source = receipt.results?.[0]?.source;
                            if (!source) {
                                enqueue(sseChunk('Workspace search returned no accessible evidence.'));
                                enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
                            }
                            name = 'workspace_read'; args = { item: { kind: source.kind, id: source.id } };
                        } else {
                            name = 'workspace_search'; args = { query: 'saffron decision', kinds: ['document'] };
                        }
                        const tools = Array.isArray(body.tools) ? body.tools : [];
                        if (!tools.some((tool) => tool && typeof tool === 'object' && (tool as { function?: { name?: string } }).function?.name === name)) {
                            enqueue(sseChunk('Workspace tools unavailable in this fixture.'));
                        } else {
                            enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
                                index: 0, id: `journey-${name}-${attempt}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
                            }] }, finish_reason: 'tool_calls' }] })}\n\n`));
                        }
                    } else if (text.includes('journey:responsive')) {
                        enqueue(sseChunk([
                            '## Responsive reply',
                            '',
                            'A long URL: https://example.com/' + 'unbroken-segment'.repeat(25),
                            '',
                            '| Column one | Column two | Column three | Column four |',
                            '| --- | --- | --- | --- |',
                            '| Long table content | Long table content | Long table content | Long table content |',
                            '',
                            '```ts',
                            'const longLine = "' + 'long-code-value'.repeat(30) + '";',
                            '```',
                            '',
                            'End of layout sample.',
                        ].join('\n')));
                    } else if (text.includes('journey:multitab')) {
                        enqueue(sseChunk('Partial response shared across tabs.'));
                        await delay(20_000);
                        enqueue(sseChunk(' Owner made progress.'));
                        await delay(60_000);
                        enqueue(sseChunk(' Late response after the owner closed.'));
                    } else if (text.includes('journey:refresh')) {
                        enqueue(sseChunk('Partial response before refresh.'));
                        await delay(650);
                        enqueue(sseChunk(' Ready to recover.'));
                        await delay(10_000);
                        enqueue(sseChunk(' Late response from the old page.'));
                    } else if (text.includes('journey:stop')) {
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
    hooks.addFilter('ui.chat.message:filter:outgoing', pauseAdmission);
    hooks.addFilter('ai.chat.messages:filter:before_send', emptyInput);
    installDeterministicFetch();
    if (workspaceJourney) {
        const key = 'or3:e2e:workspace-document';
        const remembered = localStorage.getItem(key);
        if (!remembered || !(await getDocument(remembered))) {
            const document = await createDocument({ title: 'Workspace evidence', content: { type: 'doc', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'The saffron decision is to preserve the original source.' }] },
            ] } });
            localStorage.setItem(key, document.id);
        }
    }
    localStorage.setItem(
        'or3:server-route-available',
        JSON.stringify({ available: false, timestamp: Date.now() })
    );
    threadId.value = localStorage.getItem(THREAD_KEY) ?? '';
    if (threadId.value) {
        await ensureThreadHistoryLoaded(
            threadId,
            ref<string | null>(null),
            messageHistory
        );
    }
    await persistUserApiKey(TEST_API_KEY);
    ready.value = true;
});

onBeforeUnmount(() => {
    hooks.removeFilter('ui.chat.message:filter:outgoing', pauseAdmission);
    hooks.removeFilter('ai.chat.messages:filter:before_send', emptyInput);
    restoreFetch?.();
});
</script>
