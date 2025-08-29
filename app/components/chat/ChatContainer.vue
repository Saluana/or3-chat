<template>
    <main
        ref="containerRoot"
        class="flex w-full flex-1 flex-col overflow-hidden"
    >
        <!-- Scroll viewport -->
        <div
            ref="scrollParent"
            class="absolute w-full h-screen overflow-y-auto overscroll-contain px-[3px] sm:pt-3.5 scrollbars"
            :style="{ paddingBottom: bottomPad + 'px' }"
        >
            <div
                class="mx-auto w-full px-1.5 sm:max-w-[768px] pb-10 pt-safe-offset-10 flex flex-col"
            >
                <!-- Virtualized stable messages (Req 3.1) -->
                <VirtualMessageList
                    :messages="virtualMessages"
                    :item-size-estimation="520"
                    :overscan="5"
                    :scroll-parent="scrollParent"
                    wrapper-class="flex flex-col"
                >
                    <template #item="{ message, index }">
                        <div
                            :key="message.id || message.stream_id || index"
                            class="first:mt-0 mt-10"
                        >
                            <ChatMessage
                                :message="message"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                            />
                        </div>
                    </template>
                    <template #tail>
                        <!-- Streaming tail appended (Req 3.2) -->
                        <div v-if="tailActive" class="mt-10 first:mt-0">
                            <div
                                class="bg-white/5 border-2 border-[var(--md-inverse-surface)] w-full retro-shadow backdrop-blur-sm p-2 min-w-[140px] rounded-md relative animate-in fade-in"
                                style="animation-duration: 120ms"
                            >
                                <!-- Inner content wrapper mirrors assistant ChatMessage innerClass -->
                                <div
                                    class="prose max-w-none dark:text-white/95 dark:prose-headings:text-white/95! w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5"
                                    v-html="tailRendered || tailPlaceholder"
                                />
                                <div
                                    class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
                                >
                                    <span
                                        class="text-[10px] px-2 py-0.5 rounded bg-[var(--md-surface-container-lowest)] border border-black retro-shadow"
                                        >Streaming…</span
                                    >
                                </div>
                            </div>
                        </div>
                    </template>
                </VirtualMessageList>
            </div>
        </div>
        <!-- Input area overlay -->
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center sm:pr-[11px] px-1"
            >
                <chat-input-dropper
                    ref="chatInputEl"
                    :loading="loading"
                    :container-width="containerWidth"
                    :thread-id="currentThreadId"
                    @send="onSend"
                    @model-change="onModelChange"
                    @pending-prompt-selected="onPendingPromptSelected"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
// Refactored ChatContainer (Task 4) – orchestration only.
// Reqs: 3.1,3.2,3.3,3.4,3.5,3.6,3.10,3.11
import ChatMessage from './ChatMessage.vue';
import { shallowRef, computed, watch, ref, nextTick } from 'vue';
import { parseFileHashes } from '~/db/files-util';
import { db } from '~/db';
import { useChat } from '~/composables/useAi';
import type {
    ChatMessage as ChatMessageType,
    ContentPart,
} from '~/utils/chat/types';
import { useHookEffect } from '~/composables/useHookEffect';
import { marked } from 'marked';
import VirtualMessageList from './VirtualMessageList.vue';
import { useTailStream } from '../../composables/useTailStream';
import { useAutoScroll } from '../../composables/useAutoScroll';
import { useChatSend } from '../../composables/useChatSend';
import { useElementSize } from '@vueuse/core';

const model = ref('openai/gpt-oss-120b');
const pendingPromptId = ref<string | null>(null);

// Resize (Req 3.4): useElementSize -> reactive width
const containerRoot = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(containerRoot);
// Dynamic chat input height to compute scroll padding
const chatInputEl = ref<HTMLElement | null>(null);
const { height: chatInputHeight } = useElementSize(chatInputEl);
const bottomPad = computed(() => {
    // Add extra breathing space so last message sits above input slightly
    const h = chatInputHeight.value || 140; // fallback similar to prior fixed 165
    return Math.round(h + 36); // 36px buffer
});

function onModelChange(newModel: string) {
    model.value = newModel;
    // Silenced model change log.
}

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessageType[];
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(
    useChat(
        props.messageHistory,
        props.threadId,
        pendingPromptId.value || undefined
    )
);

watch(
    () => props.threadId,
    (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) return;
        chat.value = useChat(
            props.messageHistory,
            newId,
            pendingPromptId.value || undefined
        );
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
        if (!prev && id) {
            emit('thread-selected', id);
            // Clear pending prompt since it's now applied to the thread
            pendingPromptId.value = null;
        }
    }
);

// Render messages with content narrowed to string for ChatMessage.vue
type RenderMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
    file_hashes?: string | null; // serialized JSON array (from DB/user memory)
    pending?: boolean; // UI-only flag for skeleton loader
};
function escapeAttr(v: string) {
    return v
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
const messages = computed<RenderMessage[]>(() =>
    (chat.value.messages.value || []).map((m: ChatMessageType & any) => {
        let contentStr = '';
        if (typeof m.content === 'string') {
            contentStr = m.content;
        } else if (Array.isArray(m.content)) {
            const segs: string[] = [];
            for (const p of m.content as ContentPart[]) {
                if (p.type === 'text') {
                    segs.push(p.text);
                } else if (p.type === 'image') {
                    const src = typeof p.image === 'string' ? p.image : '';
                    if (src.startsWith('data:image/')) {
                        segs.push(
                            `<div class=\"my-3\"><img src=\"${escapeAttr(
                                src
                            )}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full\" loading=\"lazy\" decoding=\"async\"/></div>`
                        );
                    } else if (src) {
                        segs.push(
                            `<div class=\"my-3\"><img src=\"${escapeAttr(
                                src
                            )}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\"/></div>`
                        );
                    }
                } else if (p.type === 'file') {
                    const label = (p as any).name || p.mediaType || 'file';
                    segs.push(`**[file:${escapeAttr(label)}]**`);
                }
            }
            contentStr = segs.join('\n\n');
        } else {
            contentStr = String((m as any).content ?? '');
        }
        // If no inline image tags generated but file_hashes exist (assistant persisted images), append placeholders that resolve via thumbs/gallery
        const hasImgTag = /<img\s/i.test(contentStr);
        if (!hasImgTag && (m as any).file_hashes) {
            const hashes = parseFileHashes((m as any).file_hashes);
            if (hashes.length) {
                const gallery = hashes
                    .map(
                        (h) =>
                            `<div class=\"my-3\"><img data-file-hash=\"${escapeAttr(
                                h
                            )}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full opacity-60\" /></div>`
                    )
                    .join('');
                contentStr += (contentStr ? '\n\n' : '') + gallery;
            }
        }
        return {
            role: m.role,
            content: contentStr,
            id: m.id,
            stream_id: m.stream_id,
            file_hashes: (m as any).file_hashes,
            pending: (m as any).pending,
        } as RenderMessage;
    })
);
const loading = computed(() => chat.value.loading.value);

// Tail streaming via composable (Req 3.2)
const tail = useTailStream({ flushIntervalMs: 50, immediate: true });
const tailStreamId = ref<string | null>(null);
// Current thread id for this container (reactive)
const currentThreadId = computed(() => chat.value.threadId?.value);
const tailActive = computed(() => tail.isStreaming.value);
const tailRendered = computed(() =>
    tail.displayText.value ? marked.parse(tail.displayText.value) : ''
);
const tailPlaceholder = computed(() =>
    !tail.displayText.value ? 'Thinking…' : ''
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

// Virtual list data excludes streaming assistant (Req 3.2 separation)
const virtualMessages = computed(() => {
    const base =
        !tailActive.value || !tailStreamId.value
            ? messages.value
            : messages.value.filter((m) => m.stream_id !== tailStreamId.value);
    // Ensure id present (fallback to index) to satisfy child expectation of string id
    return base.map((m, i) => ({ ...m, id: m.id || String(i) }));
});

// Scroll handling (Req 3.3) via useAutoScroll
const scrollParent = ref<HTMLElement | null>(null);
const autoScroll = useAutoScroll(scrollParent, { thresholdPx: 64 });
watch(
    () => messages.value.length,
    async () => {
        await nextTick();
        autoScroll.onContentIncrease();
    }
);
watch(
    () => tail.displayText.value,
    () => {
        if (tailActive.value) autoScroll.onContentIncrease();
    }
);

// Initial bottom stick after mount (defer to allow user immediate scroll cancel)
nextTick(() => {
    setTimeout(() => {
        if (autoScroll.atBottom.value)
            autoScroll.scrollToBottom({ smooth: false });
    }, 0);
});

// Hook: streaming delta buffering
useHookEffect(
    'ai.chat.stream:action:delta',
    (delta: string, meta: any) => {
        // Filter: only react if this delta belongs to this pane's thread
        if (meta?.threadId && meta.threadId !== currentThreadId.value) return;
        const sid = meta?.streamId || meta?.assistantId || 'stream';
        if (!tailStreamId.value || tailStreamId.value !== sid) {
            tailStreamId.value = sid;
            tail.reset();
        }
        tail.push(String(delta || ''));
    },
    { kind: 'action', priority: 20 }
);

// Hook: after send (finalize)
useHookEffect(
    'ai.chat.send:action:after',
    (meta?: any) => {
        if (meta?.threadId && meta.threadId !== currentThreadId.value) return;
        tail.complete();
        nextTick(() => autoScroll.onContentIncrease());
    },
    { kind: 'action', priority: 50 }
);

// Hook: error path
useHookEffect(
    'ai.chat.error:action',
    (meta?: any) => {
        if (meta?.threadId && meta.threadId !== currentThreadId.value) return;
        tail.fail(new Error('stream-error'));
    },
    { kind: 'action', priority: 50 }
);

// Forward tail error (Req 3.10) – placeholder for hook system integration
watch(
    () => tail.error.value,
    (err) => {
        if (err) {
            // Could integrate hooks.doAction('chat.error', { source: 'tail', error: err }) if available
            // eslint-disable-next-line no-console
            console.error('[ChatContainer] tail error', err);
        }
    }
);

// Reset tail state when switching threads to prevent ghost streaming across panes
watch(currentThreadId, () => {
    tail.reset();
    tailStreamId.value = null;
});

// When input height changes and user was at bottom, keep them pinned
watch(
    () => chatInputHeight.value,
    async () => {
        await nextTick();
        if (autoScroll.atBottom.value) {
            autoScroll.scrollToBottom({ smooth: false });
        }
    }
);

// Auto-scroll as tailDisplay grows
// Chat send abstraction (Req 3.5)
const chatSend = useChatSend();

function onSend(payload: any) {
    if (loading.value) return;
    const readyImages = Array.isArray(payload.images)
        ? payload.images.filter((img: any) => img && img.status === 'ready')
        : [];
    const pendingCount = Array.isArray(payload.images)
        ? payload.images.filter((img: any) => img && img.status === 'pending')
              .length
        : 0;
    if (pendingCount > 0 && readyImages.length === 0) {
        // Defer sending until at least one image hashed (user can click again shortly)
        console.warn(
            '[ChatContainer.onSend] images still hashing; delaying send'
        );
        return;
    }
    const files = readyImages.map((img: any) => ({
        type: img.file?.type || 'image/png',
        url: img.url,
    }));
    const file_hashes = readyImages
        .map((img: any) => img.hash)
        .filter((h: any) => typeof h === 'string');
    const extraTextParts = Array.isArray(payload.largeTexts)
        ? payload.largeTexts.map((t: any) => t.text).filter(Boolean)
        : [];

    // Basic transformation retained (future: move fully into useChatSend)
    const result = chatSend.send({
        threadId: chat.value.threadId?.value || '',
        text: payload.text,
    });
    chat.value
        .sendMessage(payload.text, {
            model: model.value,
            files,
            file_hashes,
            extraTextParts,
            online: !!payload.webSearchEnabled,
        })
        .catch((e: any) =>
            console.error('[ChatContainer.onSend] sendMessage error', e)
        );
    return result;
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

function onPendingPromptSelected(promptId: string | null) {
    pendingPromptId.value = promptId;
    // Reinitialize chat with the pending prompt
    chat.value = useChat(
        props.messageHistory,
        props.threadId,
        pendingPromptId.value || undefined
    );
}
</script>

<style>
/* Optional custom styles placeholder */
</style>
