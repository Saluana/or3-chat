<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <!-- Scroll container / viewport for virtualization -->
        <div
            ref="scrollParent"
            class="absolute w-full h-screen overflow-y-auto overscroll-contain sm:pt-3.5 pb-[165px] scrollbars"
        >
            <!-- Virtualized message list -->
            <div
                class="mx-auto w-full px-1.5 sm:px-0 sm:max-w-[768px] pb-10 pt-safe-offset-10"
            >
                <Virtualizer
                    ref="virtualizerRef"
                    :data="virtualMessages"
                    :itemSize="virtualItemSize"
                    :overscan="8"
                    :scrollRef="scrollParent || undefined"
                    class="flex flex-col"
                >
                    <template #default="{ item, index }">
                        <div
                            :key="item.id || item.stream_id || index"
                            class="first:mt-0 mt-10"
                            :data-index="index"
                        >
                            <ChatMessage
                                :message="item"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                            />
                        </div>
                    </template>
                </Virtualizer>
                <!-- Live streaming tail (excluded from virtualizer for smoother incremental updates) -->
                <div
                    v-if="tailActive"
                    class="mt-10 first:mt-0"
                    :key="tailStreamId || 'streaming-tail'"
                >
                    <div
                        class="bg-white/5 border-2 w-full retro-shadow backdrop-blur-sm p-1 sm:p-5 rounded-md relative animate-in fade-in"
                        style="animation-duration: 120ms"
                    >
                        <div
                            class="prose max-w-none w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                            v-html="tailRendered || tailPlaceholder"
                        />
                        <div
                            class="absolute -bottom-5 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
                        >
                            <span
                                class="text-[10px] px-2 py-0.5 rounded bg-[var(--md-surface-container-lowest)] border border-black retro-shadow"
                                >Streaming…</span
                            >
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center pr-0.5 sm:pr-[11px]"
            >
                <chat-input-dropper
                    :loading="loading"
                    @send="onSend"
                    @model-change="onModelChange"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import ChatMessage from './ChatMessage.vue';
import {
    shallowRef,
    computed,
    watch,
    ref,
    nextTick,
    onMounted,
    onBeforeUnmount,
} from 'vue';
import { useChat } from '~/composables/useAi';
import type {
    ChatMessage as ChatMessageType,
    ContentPart,
} from '~/composables/useAi';
import { Virtualizer } from 'virtua/vue';
import { useHookEffect } from '~/composables/useHookEffect';
import { marked } from 'marked';

const model = ref('openai/gpt-oss-120b');

function onModelChange(newModel: string) {
    model.value = newModel;
    console.log('Model changed to:', newModel);
}

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessageType[];
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(useChat(props.messageHistory, props.threadId));

watch(
    () => props.threadId,
    (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) return;
        chat.value = useChat(props.messageHistory, newId);
    }
);

// Keep composable messages in sync when parent provides an updated messageHistory
watch(
    () => props.messageHistory,
    (mh) => {
        if (!chat.value) return;
        // While streaming, don't clobber the in-flight assistant placeholder with stale DB content
        if (chat.value.loading.value) return;
        // Prefer to update the internal messages array directly to avoid remount flicker
        chat.value.messages.value = [...(mh || [])];
    }
);

// When a new thread id is created internally (first send), propagate upward once
watch(
    () => chat.value?.threadId?.value,
    (id, prev) => {
        if (!prev && id) emit('thread-selected', id);
    }
);

// Render messages with content narrowed to string for ChatMessage.vue
type RenderMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
    file_hashes?: string | null; // serialized JSON array (from DB/user memory)
};
const messages = computed<RenderMessage[]>(() =>
    (chat.value.messages.value || []).map((m: ChatMessageType & any) => {
        let contentStr: string;
        if (typeof m.content === 'string') contentStr = m.content;
        else if (Array.isArray(m.content)) {
            contentStr = (m.content as ContentPart[])
                .map((p) => {
                    if (p.type === 'text') return p.text;
                    if (p.type === 'image') return '';
                    if (p.type === 'file')
                        return `**[file:${
                            (p as any).name ?? (p as any).mediaType ?? 'file'
                        }]**`;
                    return '';
                })
                .filter(Boolean)
                .join('\n\n');
        } else contentStr = String((m as any).content ?? '');
        return {
            role: m.role,
            content: contentStr,
            id: m.id,
            stream_id: m.stream_id,
            file_hashes: (m as any).file_hashes,
        } as RenderMessage;
    })
);
const loading = computed(() => chat.value.loading.value);

// --- Hybrid tail streaming state ---
const tailActive = ref(false);
const tailStreamId = ref<string | null>(null);
const tailBuffer = ref(''); // accumulated but not yet flushed
const tailDisplay = ref(''); // flushed text (rendered markdown)
const tailStartedAt = ref<number | null>(null);
const tailLastFlush = ref(0);
const tailInitialDelayMs = 500; // per spec
const tailMinFlushInterval = 50; // ms between flush rAF batches
let tailRaf: number | null = null;

function resetTail() {
    tailActive.value = false;
    tailStreamId.value = null;
    tailBuffer.value = '';
    tailDisplay.value = '';
    tailStartedAt.value = null;
    tailLastFlush.value = 0;
    if (tailRaf) {
        cancelAnimationFrame(tailRaf);
        tailRaf = null;
    }
}

function ensureTailFlushLoop() {
    if (tailRaf != null) return;
    const loop = () => {
        tailRaf = null;
        if (!tailActive.value) return; // stopped
        const now = performance.now();
        const elapsed = tailStartedAt.value ? now - tailStartedAt.value : 0;
        const ready =
            elapsed >= tailInitialDelayMs &&
            tailBuffer.value.length > 0 &&
            now - tailLastFlush.value >= tailMinFlushInterval;
        if (ready) {
            tailDisplay.value += tailBuffer.value;
            tailBuffer.value = '';
            tailLastFlush.value = now;
        }
        if (tailActive.value) tailRaf = requestAnimationFrame(loop);
    };
    tailRaf = requestAnimationFrame(loop);
}

// Rendered HTML for tail (markdown parse only on flush increments to keep cost lower)
const tailRendered = computed(() =>
    tailDisplay.value ? marked.parse(tailDisplay.value) : ''
);
const tailPlaceholder = computed(() =>
    !tailDisplay.value && !tailBuffer.value ? 'Thinking…' : ''
);

// Identify the current streaming assistant message (last assistant with empty OR growing content while loading)
const streamingAssistant = computed(() => {
    if (!loading.value) return null;
    const arr = messages.value;
    if (!arr.length) return null;
    const last = arr[arr.length - 1];
    if (last && last.role === 'assistant') return last;
    return null;
});

// Virtualizer data excludes the active streaming assistant when tailActive
const virtualMessages = computed(() => {
    if (!tailActive.value || !tailStreamId.value) return messages.value;
    return messages.value.filter((m) => m.stream_id !== tailStreamId.value);
});

// Virtualization helpers
const scrollParent = ref<HTMLElement | null>(null);
const virtualizerRef = ref<any>(null);
const userIsAtBottom = ref(true);

// Provide a numeric size (dynamic measurement handled internally by virtua if content resizes)
const virtualItemSize = 320;

const lastMessage = computed(() => messages.value[messages.value.length - 1]);

function handleScrollEvent() {
    if (!scrollParent.value) return;
    const el = scrollParent.value;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    userIsAtBottom.value = distance < 16; // 1rem threshold
}

function scrollToBottom(smooth = true) {
    if (!scrollParent.value) return;
    // While streaming tail is active we exclude the assistant message from virtualizer; scrolling to index would jump upward.
    if (tailActive.value) {
        scrollParent.value.scrollTo({
            top: scrollParent.value.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
        });
        return;
    }
    if (virtualizerRef.value && messages.value.length) {
        try {
            virtualizerRef.value.scrollToIndex(messages.value.length - 1, {
                align: 'end',
                smooth,
            });
            return; // success
        } catch (_) {
            /* fallback below */
        }
    }
    scrollParent.value.scrollTo({
        top: scrollParent.value.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
    });
}

// Auto-scroll on new messages if user at bottom
watch(
    () => messages.value.length,
    async () => {
        await nextTick();
        if (userIsAtBottom.value) scrollToBottom(false);
    }
);

onMounted(() => {
    scrollParent.value?.addEventListener('scroll', handleScrollEvent, {
        passive: true,
    });
    // Initial scroll after mount for existing history
    nextTick(() => scrollToBottom(false));
});
onBeforeUnmount(() => {
    scrollParent.value?.removeEventListener('scroll', handleScrollEvent);
});

// Hook: streaming delta buffering
useHookEffect(
    'ai.chat.stream:action:delta',
    (delta: string, meta: any) => {
        // Activate tail if first delta for a new stream
        if (!tailActive.value) {
            tailActive.value = true;
            tailStreamId.value =
                meta?.streamId || meta?.assistantId || 'stream';
            tailStartedAt.value = performance.now();
            tailBuffer.value = '';
            tailDisplay.value = '';
            ensureTailFlushLoop();
        }
        // Different stream? finalize previous and start new.
        if (
            tailActive.value &&
            tailStreamId.value &&
            meta?.streamId &&
            meta.streamId !== tailStreamId.value
        ) {
            // finalize old silently (will be brought in when loading toggles false)
            resetTail();
            tailActive.value = true;
            tailStreamId.value = meta.streamId;
            tailStartedAt.value = performance.now();
            ensureTailFlushLoop();
        }
        tailBuffer.value += String(delta || '');
    },
    { kind: 'action', priority: 20 }
);

// Hook: after send (finalize)
useHookEffect(
    'ai.chat.send:action:after',
    () => {
        // Force final flush
        if (tailBuffer.value.length) {
            tailDisplay.value += tailBuffer.value;
            tailBuffer.value = '';
        }
        // Delay re-including the message until next tick so virtualizer sees stable array
        nextTick(() => {
            resetTail();
            nextTick(() => {
                if (userIsAtBottom.value) scrollToBottom(false);
            });
        });
    },
    { kind: 'action', priority: 50 }
);

// Hook: error path
useHookEffect(
    'ai.chat.error:action',
    () => {
        resetTail();
    },
    { kind: 'action', priority: 50 }
);

// Auto-scroll as tailDisplay grows
watch(
    () => tailDisplay.value,
    () => {
        if (tailActive.value && userIsAtBottom.value) scrollToBottom(false);
    }
);

function onSend(payload: any) {
    console.log('[ChatContainer.onSend] raw payload', payload);
    if (loading.value) return; // prevent duplicate sends while streaming

    let reqParams: any = {
        files: [],
        model: model.value,
    };

    let fileHashes: string[] = [];
    if (payload.images && payload.images.length > 0) {
        const inferType = (url: string, provided?: string) => {
            if (provided && provided.startsWith('image/')) return provided;
            const m = /^data:([^;]+);/i.exec(url);
            if (m) return m[1];
            const lower = (url.split('?')[0] || '').toLowerCase();
            const ext = lower.substring(lower.lastIndexOf('.') + 1);
            const map: Record<string, string> = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                webp: 'image/webp',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                avif: 'image/avif',
                heic: 'image/heic',
                heif: 'image/heif',
                bmp: 'image/bmp',
                tif: 'image/tiff',
                tiff: 'image/tiff',
                ico: 'image/x-icon',
            };
            return map[ext] || 'image/png';
        };
        reqParams.files = payload.images.map((p: any, i: number) => {
            const url: string = p.url;
            const preview = (url || '').slice(0, 60);
            const mime = inferType(url, p.type);
            console.log('[ChatContainer.onSend] image found', {
                index: i,
                preview,
                mime,
            });
            if (p.hash && p.status === 'ready') fileHashes.push(p.hash);
            return { url, type: mime };
        });
    }

    // Large pasted text blocks -> send as extraTextParts so they become additional text parts (not files)
    if (payload.largeTexts && payload.largeTexts.length) {
        reqParams.extraTextParts = payload.largeTexts.map((b: any) => b.text);
    }

    console.log('[ChatContainer.onSend] transformed reqParams', reqParams);

    (reqParams as any).file_hashes = fileHashes;

    chat.value
        .sendMessage(payload.text, reqParams as any)
        .then(() => {
            console.log('[ChatContainer.onSend] sendMessage resolved', {
                messageCount: chat.value.messages.value.length,
                lastMessage:
                    chat.value.messages.value[
                        chat.value.messages.value.length - 1
                    ],
            });
        })
        .catch((e: any) => {
            console.error('[ChatContainer.onSend] sendMessage error', e);
        });
}

function onRetry(messageId: string) {
    if (!chat.value || chat.value.loading.value) return;
    // Provide current model so retry uses same selection
    (chat.value as any).retryMessage(messageId, model.value);
}

function onBranch(newThreadId: string) {
    if (newThreadId) emit('thread-selected', newThreadId);
}

function onEdited(payload: { id: string; content: string }) {
    if (!chat.value) return;
    const arr = chat.value.messages.value;
    const idx = arr.findIndex((m: any) => m.id === payload.id);
    if (idx === -1) return;
    const msg = arr[idx];
    if (!msg) return;
    // If message content is a parts array, update the first text part; else update string directly
    if (Array.isArray(msg.content)) {
        const firstText = (msg.content as any[]).find((p) => p.type === 'text');
        if (firstText) firstText.text = payload.content;
        else
            (msg.content as any[]).unshift({
                type: 'text',
                text: payload.content,
            });
    } else {
        msg.content = payload.content;
    }
    // Trigger reactivity for computed messages mapping
    chat.value.messages.value = [...arr];
}
</script>

<style>
/* Optional custom styles placeholder */
</style>
