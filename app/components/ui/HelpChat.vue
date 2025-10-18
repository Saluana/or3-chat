<template>
    <div class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
        <div
            v-if="isExpanded"
            class="flex flex-col border-2 border-[var(--md-inverse-surface)] rounded-[3px] retro-shadow bg-[var(--md-surface)] w-[min(40dvw)] h-[min(80dvh)] overflow-hidden"
        >
            <div
                class="flex h-10 items-center justify-between border-b-2 border-[var(--md-inverse-surface)] px-3"
            >
                <span class="text-sm font-medium uppercase tracking-wide"
                    >Help Chat</span
                >
                <UButton
                    size="xs"
                    :square="true"
                    icon="pixelarticons:close"
                    class="retro-btn aspect-square"
                    :ui="{
                        base: 'retro-btn aspect-square flex items-center justify-center',
                    }"
                    aria-label="Close help chat"
                    @click="collapse"
                />
            </div>

            <div
                ref="scrollContainer"
                class="flex-1 overflow-y-auto px-3 py-4 space-y-3 text-sm"
            >
                <div
                    v-for="msg in messages.filter(
                        (m) =>
                            m.role !== 'tool' || !m.content || m.content === ''
                    )"
                    :key="msg.id"
                    :class="[
                        'rounded-[3px] px-3 py-2 leading-relaxed text-sm w-fit max-w-[95%] break-words',
                        msg.role === 'user'
                            ? ' border-2 border-[var(--md-inverse-surface)] retro-shadow  ml-auto text-left bg-[var(--md-primary)]/15 text-[var(--md-on-primary-container)]'
                            : 'max-w-[100%] px-5',
                        msg.kind === 'error'
                            ? 'bg-[var(--md-error-container)] text-[var(--md-on-error-container)]'
                            : null,
                        msg.kind === 'info'
                            ? 'bg-[var(--md-surface-container-low)] text-[var(--md-on-surface)]'
                            : null,
                    ]"
                >
                    <span
                        v-if="msg.pending && !msg.content"
                        class="text-xs uppercase tracking-wide opacity-70 animate-pulse"
                        >Thinking...</span
                    >
                    <StreamMarkdown
                        v-else-if="msg.content"
                        :content="msg.content"
                        :shiki-theme="currentShikiTheme"
                        class="help-chat-content prose-retro max-w-none"
                        :allowed-link-prefixes="['https://', 'http://', '/']"
                        :allowed-image-prefixes="['https://', 'http://', '/']"
                        :code-block-show-line-numbers="false"
                    ></StreamMarkdown>
                </div>
            </div>

            <form
                class="border-t-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface)] px-3 py-3"
                @submit.prevent="sendMessage"
            >
                <div class="flex items-end gap-2">
                    <UInput
                        ref="inputRef"
                        v-model="message"
                        placeholder="Ask about Or3 Chat..."
                        size="md"
                        class="flex-1"
                        :disabled="isSending"
                    />
                    <UButton
                        type="submit"
                        size="md"
                        class="retro-btn px-4"
                        :ui="{
                            base: 'retro-btn px-4 flex items-center gap-2 font-medium',
                        }"
                        :loading="isSending"
                        :disabled="!canSend"
                    >
                        <UIcon name="pixelarticons:arrow-up" class="h-4 w-4" />
                        <span>Send</span>
                    </UButton>
                </div>
                <p
                    v-if="!apiKey"
                    class="mt-2 text-xs text-[var(--md-on-surface-variant)]"
                >
                    Add your OpenRouter key in Settings to enable replies.
                </p>
            </form>
        </div>

        <UButton
            v-else
            size="md"
            icon="pixelarticons:message-processing"
            class="retro-btn aspect-square w-12 h-12 flex items-center justify-center"
            :ui="{
                base: 'retro-btn aspect-square w-12 h-12 flex items-center justify-center',
            }"
            aria-label="Open help chat"
            @click="expand"
        />
    </div>
</template>

<script setup lang="ts">
import { StreamMarkdown } from 'streamdown-vue';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import type { ToolCall, ToolDefinition } from '~/utils/chat/types';

const props = defineProps<{ documentationMap?: string }>();

type HelpChatRole = 'assistant' | 'user' | 'tool';
type HelpChatKind = 'info' | 'error' | undefined;

interface HelpChatMessage {
    id: string;
    role: HelpChatRole;
    content: string;
    reasoning_details?: any;
    tool_call_id?: string;
    pending?: boolean;
    kind?: HelpChatKind;
}

const { apiKey } = useUserApiKey();
const toast = useToast();
const { $theme } = useNuxtApp();

const currentShikiTheme = computed(() => {
    const theme =
        ($theme as any)?.current?.value ?? ($theme as any)?.get?.() ?? 'light';
    return String(theme).startsWith('dark') ? 'github-dark' : 'github-light';
});

const isExpanded = ref(false);
const isSending = ref(false);
const message = ref('');
const inputRef = ref<{ input?: HTMLInputElement } | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);

let messageId = 0;

const messages = ref<HelpChatMessage[]>([
    {
        id: createMessageId(),
        role: 'assistant',
        content:
            'Hi there! I can help you explore Or3 Chat. Ask me anything about the app, commands, or workflows.',
        kind: 'info',
    },
]);

const canSend = computed(() =>
    Boolean(message.value.trim().length && apiKey.value && !isSending.value)
);

onMounted(() => {
    scrollToBottom('auto');
});

function createMessageId() {
    messageId += 1;
    return `help-${messageId}`;
}

function expand() {
    isExpanded.value = true;

    nextTick(() => {
        focusInput();
        scrollToBottom('auto');
    });
}

function collapse() {
    isExpanded.value = false;
}

function focusInput() {
    const input = inputRef.value?.input;
    if (input) {
        input.focus();
    }
}

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    if (!import.meta.client) return;
    const container = scrollContainer.value;
    if (!container) return;

    requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior });
    });
}

async function pushMessage(
    msg: HelpChatMessage,
    behavior: ScrollBehavior = 'smooth'
) {
    messages.value.push(msg);
    await nextTick();
    scrollToBottom(behavior);
}

async function getDocumentation(path: string) {
    try {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const response = await fetch(`/_documentation${normalized}.md`);
        if (!response.ok) {
            throw new Error('Failed to load documentation');
        }
        return await response.text();
    } catch (error) {
        console.error('[HelpChat] getDocs failed', error);
        toast.add({
            title: 'Docs error',
            description:
                error instanceof Error
                    ? error.message
                    : 'Something went wrong while fetching the docs.',
            color: 'error',
        });
    }
}

async function sendMessage() {
    const trimmed = message.value.trim();

    if (!trimmed || isSending.value) return;

    if (!apiKey.value) {
        toast.add({
            title: 'OpenRouter key required',
            description:
                'Add your OpenRouter API key in Settings to ask the help chat questions.',
            color: 'warning',
        });
        return;
    }

    isSending.value = true;

    await pushMessage(
        {
            id: createMessageId(),
            role: 'user',
            content: trimmed,
        },
        'auto'
    );

    message.value = '';

    const assistantMessage: HelpChatMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: '',
        pending: true,
    };

    messages.value.push(assistantMessage);
    await nextTick();
    const reactiveAssistantMessage = messages.value.find(
        (m) => m.id === assistantMessage.id
    );
    scrollToBottom('auto');

    try {
        // Fetch docmap for tool context
        let docmapJson = '';
        if (props.documentationMap) {
            docmapJson = props.documentationMap;
        } else {
            try {
                const docmapResponse = await fetch(
                    '/_documentation/docmap.json'
                );
                if (docmapResponse.ok) {
                    const docmapData = await docmapResponse.json();
                    docmapJson = JSON.stringify(docmapData, null, 2);
                }
            } catch (err) {
                console.warn('[HelpChat] Failed to load docmap', err);
            }
        }

        const systemPrompt = `You are the AI assistant for the Or3 Chat developer documentation.

Or3 is an open source chat application built with Nuxt 4 and Vite, made for developers.

## Your Task
Help developers understand and use the Or3 Chat codebase by searching the documentation.

## Important Rules
1. **ALWAYS use the search_docs tool FIRST** when a user asks about specific features, composables, hooks, or functionality
2. **DO NOT attempt to answer from memory** - you must search the docs to get accurate information
3. Use the DOCMAP below to identify which documentation files to search
4. You can call search_docs multiple times in one response if needed
5. After retrieving documentation, provide clear explanations with code examples
6. Always link to relevant documentation pages using markdown: [text](/documentation/path)

## Example Interaction
User: "How do I use useChat?"
You should: Call search_docs with query "/composables/useChat" to get the documentation, then explain based on that content.

User: "How do I listen for events?"
You should: Call search_docs with query "/hooks/hooks" to understand the hook system, then explain.

## Available Tool
- search_docs(query): Fetches full documentation for a given path (e.g., "/composables/useChat")

## Documentation Map
The DOCMAP below shows all available documentation with summaries. Scan it to find relevant paths:

${docmapJson}

Remember: ALWAYS call search_docs before answering. Never say you don't know without searching first.`;

        const toolDefs: ToolDefinition[] = [
            {
                type: 'function',
                function: {
                    name: 'search_docs',
                    description:
                        'Fetch the full content of a specific Or3 Chat documentation file. Use this tool whenever you need detailed information about composables, hooks, utilities, or any feature. Call this multiple times if you need to reference multiple docs. The query should be a path from the DOCMAP like "/composables/useChat" or "/hooks/hooks".',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description:
                                    'The documentation path to fetch. Must match a path from the DOCMAP. Examples: "/composables/useChat", "/hooks/hook-catalog", "/database/messages"',
                            },
                        },
                        required: ['query'],
                    },
                },
            },
        ];

        // Main loop for handling interleaved tool calls and responses
        let continueLoop = true;
        let currentAssistantMessage: HelpChatMessage | null =
            reactiveAssistantMessage ?? null;

        while (continueLoop) {
            continueLoop = false;

            // On first iteration, get or create the assistant message
            // On subsequent iterations, reuse the same assistant message
            if (!currentAssistantMessage) {
                currentAssistantMessage = {
                    id: createMessageId(),
                    role: 'assistant',
                    content: '',
                    pending: true,
                };
                messages.value.push(currentAssistantMessage);
                await nextTick();
            } else {
                // Reset pending flag for next iteration but keep accumulating content
                currentAssistantMessage.pending = true;
            }

            const history = messages.value.map((m) => {
                const body: any = {
                    role: m.tool_call_id ? 'tool' : m.role,
                    content: m.content,
                };

                // Preserve reasoning_details for extended thinking models
                if (m.reasoning_details) {
                    body.reasoning_details = m.reasoning_details;
                }

                // Include tool_call_id for tool result messages
                if (m.tool_call_id) {
                    body.tool_call_id = m.tool_call_id;
                }

                return body;
            });

            let orMessages = [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                ...history,
            ];

            console.log(
                '[HelpChat] Starting API call with messages:',
                orMessages
            );

            const controller = new AbortController();
            const stream = openRouterStream({
                apiKey: apiKey.value,
                model: 'z-ai/glm-4.6',
                orMessages,
                modalities: ['text'],
                tools: toolDefs,
                signal: controller.signal,
            });

            console.log('[HelpChat] Starting to consume stream...');

            let foundToolCall = false;

            try {
                for await (const ev of stream) {
                    console.log('[HelpChat] Stream event:', ev);

                    if (ev.type === 'text') {
                        currentAssistantMessage.content += ev.text;
                        currentAssistantMessage.pending = false;
                        await nextTick();
                    } else if (ev.type === 'reasoning') {
                        currentAssistantMessage.pending = false;
                        // Handle reasoning/thinking events - accumulate as visible content
                        currentAssistantMessage.content += ev.text;
                        console.log('[HelpChat] Received reasoning:', ev.text);
                        await nextTick();
                    } else if (ev.type === 'tool_call') {
                        console.log(
                            '[HelpChat] Received tool call:',
                            ev.tool_call
                        );
                        foundToolCall = true;
                        currentAssistantMessage.pending = false;

                        if (ev.tool_call.function.name === 'search_docs') {
                            const query = JSON.parse(
                                ev.tool_call.function.arguments
                            );

                            if (!query.query) {
                                console.warn(
                                    '[HelpChat] search_docs called without a query'
                                );
                                continue;
                            }

                            console.log(
                                `[HelpChat] Fetching docs for ${query.query}`
                            );
                            const docs = await getDocumentation(query.query);

                            if (docs && docs.length > 0) {
                                console.log(
                                    `[HelpChat] Retrieved docs for ${query.query}, adding to messages`
                                );

                                // Add tool result message to the history
                                await pushMessage(
                                    {
                                        id: createMessageId(),
                                        role: 'tool',
                                        content: `Tool (search_docs) result for \`${query.query}\`:\n\n${docs}`,
                                        tool_call_id: ev.tool_call.id,
                                    },
                                    'auto'
                                );

                                // Continue the loop to get the next response
                                continueLoop = true;
                            }
                        }
                    } else if (ev.type === 'done') {
                        console.log('[HelpChat] Stream done');
                        currentAssistantMessage.pending = false;
                    }
                }
            } catch (err: any) {
                const m = String(err?.message || err).toLowerCase();
                const isAbort =
                    err?.name === 'AbortError' || m.includes('abort');
                if (isAbort) {
                    console.log('[HelpChat] Stream aborted intentionally');
                } else {
                    throw err;
                }
            }

            console.log(
                '[HelpChat] Loop iteration complete. continueLoop:',
                continueLoop
            );
            console.log(
                '[HelpChat] Current assistant message content:',
                currentAssistantMessage.content
            );
            console.log(
                '[HelpChat] Current assistant message pending:',
                currentAssistantMessage.pending
            );
        }

        // Conversation complete
        const lastAssistantMessage = messages.value.find(
            (m) => m.role === 'assistant' && !m.tool_call_id
        );
        if (lastAssistantMessage) {
            lastAssistantMessage.pending = false;
        }
        await nextTick();
        scrollToBottom('auto');
    } catch (error) {
        console.error('[HelpChat] Error in sendMessage:', error);
        const errorMsg =
            error instanceof Error ? error.message : 'Unknown error';

        await pushMessage(
            {
                id: createMessageId(),
                role: 'assistant',
                content: `Error: ${errorMsg}`,
                kind: 'error',
            },
            'auto'
        );
    } finally {
        isSending.value = false;
        await nextTick();
        scrollToBottom('auto');
    }
}
</script>

<style scoped>
/* Help Chat Content Styling via data-streamdown attributes */
.help-chat-content :deep(p[data-streamdown='p']) {
    margin: 0.5rem 0;
    line-height: 1.5;
}

.help-chat-content :deep(a[data-streamdown='a']) {
    color: var(--md-primary);
    text-decoration: underline;
    transition: color 0.2s;
}

.help-chat-content :deep(a[data-streamdown='a']:hover) {
    opacity: 0.8;
}

.help-chat-content :deep(code[data-streamdown='inline-code']) {
    background: var(--md-surface-container);
    color: var(--md-on-surface);
    padding: 0.1rem 0.25rem;
    border-radius: 2px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
}

/* Code block wrapper */
.help-chat-content :deep([data-streamdown='code-block']) {
    margin: 0.75rem 0;
    border: 2px solid var(--md-inverse-surface);
    border-radius: 3px;
    overflow: hidden;
}

/* Code block header */
.help-chat-content :deep([data-streamdown='code-block-header']) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--md-primary-container);
    border-bottom: 2px solid var(--md-inverse-surface);
    font-size: 0.75rem;
}

.help-chat-content :deep([data-streamdown='code-lang']) {
    text-transform: uppercase;
    color: var(--md-primary);
    letter-spacing: 0.5px;
    font-weight: 600;
}

/* Code block body */
.help-chat-content :deep([data-streamdown='code-body']) {
    background: var(--md-surface-container-lowest);
    padding: 0.75rem;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
}

.help-chat-content :deep([data-streamdown='code-body'] pre) {
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
}

.help-chat-content :deep([data-streamdown='copy-button']) {
    padding: 0.25rem 0.5rem;
    background: var(--md-primary);
    color: white;
    border: 1px solid var(--md-primary);
    border-radius: 2px;
    cursor: pointer;
    font-size: 0.7rem;
    transition: opacity 0.2s;
}

.help-chat-content :deep([data-streamdown='copy-button']:hover) {
    opacity: 0.8;
}

/* Lists */
.help-chat-content :deep(ul[data-streamdown='ul']),
.help-chat-content :deep(ol[data-streamdown='ol']) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
}

.help-chat-content :deep(li[data-streamdown='li']) {
    margin: 0.25rem 0;
}

/* Strong and emphasis */
.help-chat-content :deep(strong[data-streamdown='strong']) {
    font-weight: 600;
}

.help-chat-content :deep(em[data-streamdown='em']) {
    font-style: italic;
}

/* Headings */
.help-chat-content :deep(h1[data-streamdown='h1']),
.help-chat-content :deep(h2[data-streamdown='h2']),
.help-chat-content :deep(h3[data-streamdown='h3']),
.help-chat-content :deep(h4[data-streamdown='h4']) {
    color: var(--md-primary);
    font-weight: 600;
    margin: 0.75rem 0 0.5rem 0;
}

.help-chat-content :deep(h1[data-streamdown='h1']) {
    font-size: 1.25rem;
    border-bottom: 1px solid var(--md-inverse-surface);
    padding-bottom: 0.25rem;
}

.help-chat-content :deep(h2[data-streamdown='h2']) {
    font-size: 1.1rem;
}

.help-chat-content :deep(h3[data-streamdown='h3']) {
    font-size: 1rem;
}

/* Blockquote */
.help-chat-content :deep(blockquote[data-streamdown='blockquote']) {
    border-left: 3px solid var(--md-primary);
    padding-left: 0.75rem;
    margin: 0.5rem 0;
    color: var(--md-on-surface-variant);
    font-style: italic;
}

/* Tables */
.help-chat-content :deep([data-streamdown='table-wrapper']) {
    overflow-x: auto;
    margin: 0.75rem 0;
    border-radius: 3px;
}

.help-chat-content :deep(table[data-streamdown='table']) {
    width: 100%;
    border-collapse: collapse;
    border: 2px solid var(--md-inverse-surface);
}

.help-chat-content :deep(th[data-streamdown='th']),
.help-chat-content :deep(td[data-streamdown='td']) {
    border: 1px solid var(--md-inverse-surface);
    padding: 0.4rem 0.5rem;
    text-align: left;
    font-size: 0.9rem;
}

.help-chat-content :deep(th[data-streamdown='th']) {
    background: var(--md-primary-container);
    font-weight: 600;
}

/* Horizontal rule */
.help-chat-content :deep(hr[data-streamdown='hr']) {
    border: none;
    border-top: 2px solid var(--md-inverse-surface);
    margin: 1rem 0;
}

/* Images */
.help-chat-content :deep(img[data-streamdown='img']) {
    max-width: 100%;
    border-radius: 3px;
    border: 1px solid var(--md-inverse-surface);
}
</style>
