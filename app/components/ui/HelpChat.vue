<template>
    <div :class="containerClass">
        <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition-all duration-200 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
        >
            <div v-if="isExpanded" :class="panelClass">
                <div
                    class="flex h-10 items-center justify-between border-b-2 border-[var(--md-inverse-surface)] px-3"
                >
                    <span class="text-sm font-medium uppercase tracking-wide"
                        >Help Chat</span
                    >
                    <div class="flex gap-1">
                        <UButton
                            v-if="!isMobile"
                            size="xs"
                            :square="true"
                            :icon="
                                isFullscreen
                                    ? 'material-symbols:fullscreen-exit'
                                    : 'material-symbols:fullscreen'
                            "
                            class="retro-btn aspect-square hidden md:flex"
                            :ui="{
                                base: 'retro-btn aspect-square flex items-center justify-center',
                            }"
                            :aria-label="
                                isFullscreen
                                    ? 'Exit fullscreen'
                                    : 'Enter fullscreen'
                            "
                            @click="toggleFullscreen"
                        />
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
                </div>

                <div ref="scrollContainer" :class="chatBodyClass">
                    <div
                        v-for="msg in messages.filter(
                            (m) =>
                                m.role !== 'tool' ||
                                !m.content ||
                                m.content === ''
                        )"
                        :key="msg.id"
                        :class="[
                            'rounded-[3px] flex flex-col px-3 py-2 leading-relaxed text-sm break-words',
                            msg.role === 'user'
                                ? 'border-2 border-[var(--md-inverse-surface)] retro-shadow ml-auto text-left bg-[var(--md-primary)]/15 text-[var(--md-on-primary-container)] w-fit max-w-[85%]'
                                : 'w-full max-w-full px-2',
                            msg.kind === 'error'
                                ? 'bg-[var(--md-error-container)] text-[var(--md-on-error-container)]'
                                : null,
                            msg.kind === 'info'
                                ? 'bg-[var(--md-surface-container-low)] text-[var(--md-on-surface)] '
                                : null,
                        ]"
                    >
                        <div
                            :class="[
                                'flex flex-col w-full',
                                msg.role === 'assistant' ? 'items-center' : '',
                            ]"
                        >
                            <span
                                v-if="msg.pending && !msg.content"
                                class="text-xs uppercase tracking-wide opacity-70 animate-pulse"
                                >Thinking...</span
                            >
                            <div
                                v-else-if="msg.tool_call_info"
                                class="text-xs uppercase tracking-wide opacity-70 italic break-all"
                            >
                                <span v-if="!msg.tool_call_info.completed">
                                    Searching
                                    <code
                                        class="px-1 bg-black/10 rounded break-all"
                                        >{{ msg.tool_call_info.query }}</code
                                    >...
                                </span>
                                <span v-else>
                                    Searched
                                    <code
                                        class="px-1 bg-black/10 rounded break-all"
                                        >{{ msg.tool_call_info.query }}</code
                                    >
                                </span>
                            </div>
                            <StreamMarkdown
                                v-else-if="msg.content"
                                :content="msg.content"
                                :shiki-theme="currentShikiTheme"
                                :class="[
                                    'w-full',
                                    isFullscreen && msg.role === 'assistant'
                                        ? 'max-w-[820px]'
                                        : 'max-w-full',
                                ]"
                                class="prose prose-pre:font-mono prose-retro prose-pre:max-w-full prose-pre:overflow-x-auto"
                                :allowed-link-prefixes="[
                                    'https://',
                                    'http://',
                                    '/',
                                ]"
                                :allowed-image-prefixes="[
                                    'https://',
                                    'http://',
                                    '/',
                                ]"
                                :code-block-show-line-numbers="false"
                            ></StreamMarkdown>
                        </div>
                    </div>
                </div>

                <form
                    :class="formClass"
                    :style="formStyle"
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
                            <UIcon
                                name="pixelarticons:arrow-up"
                                class="h-4 w-4"
                            />
                            <span>Send</span>
                        </UButton>
                    </div>
                    <p
                        v-if="!apiKey"
                        class="mt-2 text-xs text-[var(--md-on-surface-variant)]"
                    >
                        Connect your Openrouter account at or3.chat to enable
                        replies.
                    </p>
                </form>
            </div>
        </Transition>

        <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition-all duration-150 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
        >
            <div v-if="!isExpanded">
                <UButton
                    size="md"
                    icon="pixelarticons:message-processing"
                    :class="launcherClass"
                    :ui="{
                        base: 'retro-btn aspect-square w-12 h-12 flex items-center justify-center',
                    }"
                    aria-label="Open help chat"
                    @click="expand"
                />
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { StreamMarkdown } from 'streamdown-vue';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import type { ToolCall, ToolDefinition } from '~/utils/chat/types';
import { useThrottleFn } from '@vueuse/core';
import { useResponsiveState } from '~/composables/core/useResponsiveState';

const props = defineProps<{ documentationMap?: string }>();

// Maximum number of messages to keep in memory
const MAX_MESSAGES = 50;

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
    tool_call_info?: {
        name: string;
        query: string;
        completed?: boolean;
    };
}

// Separate storage for tool results to avoid bloating the visible message history
const toolResultsCache = new Map<string, string>();

const { apiKey } = useUserApiKey();
const toast = useToast();
const { $theme } = useNuxtApp();

const currentShikiTheme = computed(() => {
    const theme =
        ($theme as any)?.current?.value ?? ($theme as any)?.get?.() ?? 'light';
    return String(theme).startsWith('dark') ? 'github-dark' : 'github-light';
});

const isExpanded = ref(false);
const isFullscreen = ref(false);
const isSending = ref(false);
const message = ref('');
const inputRef = ref<{ input?: HTMLInputElement } | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);

const { isMobile } = useResponsiveState();

const containerClass = computed(() =>
    isMobile.value && isExpanded.value
        ? 'fixed inset-0 z-50'
        : 'fixed bottom-4 right-4 z-50'
);

const panelClass = computed(() => {
    const base = [
        'flex flex-col min-h-0 transition-all duration-300 ease-in-out retro-shadow bg-[var(--md-surface)] overflow-hidden',
    ];

    if (isMobile.value) {
        base.push('fixed inset-0 z-50 h-full w-full border-0 rounded-none');
    } else {
        base.push(
            'absolute bottom-0 right-0 border-2 border-[var(--md-inverse-surface)] rounded-[3px]'
        );
        base.push(
            isFullscreen.value
                ? 'w-[96dvw] h-[96dvh]'
                : 'h-[85dvh] w-[min(40dvw)]'
        );
    }

    return base;
});

const chatBodyClass = computed(() => [
    'flex-1 overflow-y-auto overflow-x-hidden space-y-3 text-sm',
    isMobile.value ? 'px-4 py-4' : 'px-3 py-4',
]);

const formClass = computed(() => [
    'border-t-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface)]',
    isMobile.value ? 'px-4 pt-3' : 'px-3 py-3',
]);

const formStyle = computed(() =>
    isMobile.value
        ? {
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }
        : undefined
);

const launcherClass = computed(
    () =>
        'retro-btn fixed bottom-4 right-4 aspect-square w-12 h-12 flex items-center justify-center z-[60]'
);

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

// Throttled scroll function to prevent excessive layout recalculations during streaming
const throttledScrollToBottom = useThrottleFn(
    (behavior: ScrollBehavior = 'smooth') => {
        if (!import.meta.client) return;
        const container = scrollContainer.value;
        if (!container) return;

        requestAnimationFrame(() => {
            container.scrollTo({ top: container.scrollHeight, behavior });
        });
    },
    100, // Update scroll at most every 100ms
    true, // Trailing edge
    false // No leading edge
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
    isFullscreen.value = false;

    // Clear cache to free memory when chat is closed
    // Keep the messages but clear the heavy documentation cache
    toolResultsCache.clear();
}

function toggleFullscreen() {
    if (isMobile.value) {
        isFullscreen.value = false;
        return;
    }

    isFullscreen.value = !isFullscreen.value;
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

// Trim messages to prevent memory bloat
function trimMessages() {
    if (messages.value.length > MAX_MESSAGES) {
        const toRemove = messages.value.length - MAX_MESSAGES;
        const removed = messages.value.splice(0, toRemove);

        // Clean up tool result cache for removed messages
        removed.forEach((msg) => {
            if (msg.tool_call_id) {
                toolResultsCache.delete(msg.tool_call_id);
            }
        });
    }
}

async function pushMessage(
    msg: HelpChatMessage,
    behavior: ScrollBehavior = 'smooth'
) {
    messages.value.push(msg);
    trimMessages();
    await nextTick();
    throttledScrollToBottom(behavior);
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
7. If linking to a spot in the documentation always use /documentation/{path} the /documentation/ prefix is required before any path.

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

                    // Retrieve full docs from cache for API, not the summary
                    const cachedDocs = toolResultsCache.get(m.tool_call_id);
                    if (cachedDocs) {
                        body.content = cachedDocs;
                    }
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

            const controller = new AbortController();
            const stream = openRouterStream({
                apiKey: apiKey.value,
                model: 'z-ai/glm-4.6',
                orMessages,
                modalities: ['text'],
                tools: toolDefs,
                signal: controller.signal,
            });

            let foundToolCall = false;

            try {
                // Batch text updates to reduce reactivity overhead
                let textBuffer = '';
                let lastUpdate = Date.now();
                const UPDATE_INTERVAL = 50; // ms - update UI at most every 50ms

                for await (const ev of stream) {
                    if (ev.type === 'text') {
                        textBuffer += ev.text;
                        const now = Date.now();

                        // Only update UI if enough time has passed or buffer is large
                        if (
                            now - lastUpdate > UPDATE_INTERVAL ||
                            textBuffer.length > 100
                        ) {
                            currentAssistantMessage.content += textBuffer;
                            textBuffer = '';
                            lastUpdate = now;
                            currentAssistantMessage.pending = false;
                        }
                    } else if (ev.type === 'reasoning') {
                        currentAssistantMessage.pending = false;
                        // Batch reasoning updates too
                        textBuffer += ev.text;
                        const now = Date.now();

                        if (
                            now - lastUpdate > UPDATE_INTERVAL ||
                            textBuffer.length > 100
                        ) {
                            currentAssistantMessage.content += textBuffer;
                            textBuffer = '';
                            lastUpdate = now;
                        }
                    } else if (ev.type === 'tool_call') {
                        console.log(
                            '[HelpChat] Received tool call:',
                            ev.tool_call
                        );
                        foundToolCall = true;

                        // Flush any pending text buffer before processing tool call
                        if (textBuffer) {
                            currentAssistantMessage.content += textBuffer;
                            textBuffer = '';
                        }
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

                            // Create a tool call message showing "Searching..."
                            const toolCallMessage: HelpChatMessage = {
                                id: createMessageId(),
                                role: 'assistant',
                                content: '',
                                tool_call_info: {
                                    name: 'search_docs',
                                    query: query.query,
                                    completed: false,
                                },
                            };
                            await pushMessage(toolCallMessage, 'auto');

                            const docs = await getDocumentation(query.query);

                            // Update the tool call message to show "Searched"
                            const toolMsg = messages.value.find(
                                (m) => m.id === toolCallMessage.id
                            );
                            if (toolMsg?.tool_call_info) {
                                toolMsg.tool_call_info.completed = true;
                            }
                            await nextTick();

                            if (docs && docs.length > 0) {
                                // Store full docs in cache, not in visible messages
                                toolResultsCache.set(ev.tool_call.id, docs);

                                // Add a lightweight summary message instead of full content
                                const summary = `Documentation loaded for \`${
                                    query.query
                                }\` (${Math.round(docs.length / 1024)}KB)`;

                                await pushMessage(
                                    {
                                        id: createMessageId(),
                                        role: 'tool',
                                        content: summary,
                                        tool_call_id: ev.tool_call.id,
                                    },
                                    'auto'
                                );

                                // Continue the loop to get the next response
                                continueLoop = true;
                            }
                        }
                    } else if (ev.type === 'done') {
                        // Flush any remaining text buffer
                        if (textBuffer) {
                            currentAssistantMessage.content += textBuffer;
                            textBuffer = '';
                        }
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
        }

        // Conversation complete
        const lastAssistantMessage = messages.value.find(
            (m) => m.role === 'assistant' && !m.tool_call_id
        );
        if (lastAssistantMessage) {
            lastAssistantMessage.pending = false;
        }
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
    }
}

watch(isMobile, (mobile) => {
    if (mobile) {
        isFullscreen.value = false;
    }
});
</script>

<style scoped>
@import '~/assets/css/prose-retro.css';
</style>
