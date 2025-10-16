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
                    v-for="msg in messages"
                    :key="msg.id"
                    :class="[
                        'retro-shadow border-2 border-[var(--md-inverse-surface)] rounded-[3px] px-3 py-2 leading-relaxed text-sm w-fit max-w-[95%] break-words',
                        msg.role === 'user'
                            ? 'ml-auto text-right bg-[var(--md-primary)]/15 text-[var(--md-on-primary-container)]'
                            : 'mr-auto text-left bg-[var(--md-surface-container-high)] text-[var(--md-on-surface)]',
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
                        v-else
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

type HelpChatRole = 'assistant' | 'user';
type HelpChatKind = 'info' | 'error' | undefined;

interface HelpChatMessage {
    id: string;
    role: HelpChatRole;
    content: string;
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
const docs = ref<string | null>(null);
const docsLoading = ref(false);
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
    if (!docs.value && !docsLoading.value) {
        ensureDocs();
    }
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

async function ensureDocs(): Promise<string | null> {
    if (docs.value || docsLoading.value) return docs.value;
    if (!import.meta.client) return null;

    docsLoading.value = true;
    try {
        const response = await fetch('/_documentation/llms.xml');
        if (!response.ok) {
            throw new Error('Failed to load documentation');
        }
        docs.value = await response.text();
    } catch (error) {
        console.warn('[HelpChat] Unable to load docs', error);
        toast.add({
            title: 'Docs unavailable',
            description:
                'I could not load the documentation right now. Please try again in a bit.',
            color: 'warning',
        });
        docs.value = null;
    } finally {
        docsLoading.value = false;
    }

    return docs.value;
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
    scrollToBottom('auto');

    try {
        const docsText = await ensureDocs();

        const systemPrompt = [
            'You are the Or3 Chat in-app assistant.',
            'Answer only questions about the Or3 Chat application using the provided documentation.',
            'If you are unsure, reply with: "I am sorry, I do not know how to help with that."',
            'Please link the reader to relevant documentation using the docmap.json in the documentation. Just create a link that will lead to /documentation/:path:',
            'Please actually create the link in markdown format, like [link text](/documentation/:path).',
        ].join(' ');

        const history = messages.value
            .filter(
                (m) =>
                    m.id !== assistantMessage.id &&
                    m.kind !== 'info' &&
                    m.kind !== 'error'
            )
            .map((m) => ({
                role: m.role,
                content: m.content,
            }));

        const orMessages = [
            {
                role: 'system',
                content: docsText
                    ? `<OR3_CHAT_DOCUMENTATION>${docsText}</OR3_CHAT_DOCUMENTATION>\n${systemPrompt}`
                    : systemPrompt,
            },
            ...history,
        ];

        const stream = openRouterStream({
            apiKey: apiKey.value,
            model: 'qwen/qwen-turbo',
            orMessages,
            modalities: ['text'],
        });

        let gotFirstToken = false;
        for await (const event of stream) {
            if (event.type === 'text') {
                // Find the message in the array and update it
                const msgIndex = messages.value.findIndex(
                    (m) => m.id === assistantMessage.id
                );
                if (msgIndex !== -1) {
                    const msg = messages.value[msgIndex];
                    if (msg) {
                        msg.content += event.text;
                        if (!gotFirstToken) {
                            gotFirstToken = true;
                            msg.pending = false;
                        }
                    }
                }
            }
        }

        // Final update
        const msgIndex = messages.value.findIndex(
            (m) => m.id === assistantMessage.id
        );
        if (msgIndex !== -1) {
            const msg = messages.value[msgIndex];
            if (msg) {
                msg.pending = false;
                if (!msg.content.trim()) {
                    msg.content =
                        'I am sorry, I do not know how to help with that.';
                }
            }
        }
    } catch (error) {
        console.error('[HelpChat] sendMessage failed', error);
        const msgIndex = messages.value.findIndex(
            (m) => m.id === assistantMessage.id
        );
        if (msgIndex !== -1) {
            const msg = messages.value[msgIndex];
            if (msg) {
                msg.pending = false;
                msg.kind = 'error';
                msg.content =
                    'Something went wrong while talking to OpenRouter. Please try again.';
            }
        }

        toast.add({
            title: 'Help chat error',
            description:
                error instanceof Error
                    ? error.message
                    : 'Something went wrong with the request.',
            color: 'error',
        });
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
