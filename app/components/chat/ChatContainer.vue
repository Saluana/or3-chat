<template>
    <main
        ref="containerRoot"
        class="flex w-full flex-1 h-full flex-col overflow-hidden relative"
    >
        <!-- Scroll viewport -->
        <div
            ref="scrollParent"
            class="w-full overflow-y-auto overscroll-contain px-[3px] sm:pt-3.5 scrollbars"
            :style="{ paddingBottom: bottomPad + 'px', overflowAnchor: 'auto' }"
        >
            <div
                class="mx-auto w-full px-1.5 sm:max-w-[768px] pb-8 sm:pb-10 pt-safe-offset-10 flex flex-col"
            >
                <!-- Virtualized stable messages (Req 3.1) -->
                <VirtualMessageList
                    :messages="virtualStableMessages"
                    :item-size-estimation="520"
                    :overscan="5"
                    :scroll-parent="scrollParent"
                    wrapper-class="flex flex-col"
                >
                    <template #item="{ message, index }">
                        <div
                            :key="message.id || message.stream_id || index"
                            class="group relative w-full max-w-full min-w-0 space-y-4 break-words"
                            :data-msg-id="message.id"
                            :data-stream-id="message.stream_id"
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
                        <!-- Stable virtualization ends here -->
                        <!-- Recently active (non-virtual) messages -->
                        <div
                            v-for="rm in recentMessages"
                            :key="rm.id"
                            class="min-w-0"
                            :data-msg-id="rm.id"
                            :data-stream-id="rm.stream_id"
                        >
                            <ChatMessage
                                :message="rm"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                            />
                        </div>
                        <!-- Streaming tail appended (Req 3.2) -->
                        <div
                            v-if="streamingMessage"
                            class=""
                            style="overflow-anchor: none"
                            ref="tailWrapper"
                        >
                            <ChatMessage
                                :message="streamingMessage as any"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                            />
                        </div>
                    </template>
                </VirtualMessageList>
            </div>
        </div>
        <!-- Input area overlay -->
        <div :class="inputWrapperClass" :style="inputWrapperStyle">
            <div :class="innerInputContainerClass">
                <chat-input-dropper
                    ref="chatInputEl"
                    :loading="loading"
                    :streaming="loading"
                    :container-width="containerWidth"
                    :thread-id="currentThreadId"
                    @send="onSend"
                    @model-change="onModelChange"
                    @stop-stream="onStopStream"
                    @pending-prompt-selected="onPendingPromptSelected"
                    @resize="onInputResize"
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
import { shallowRef, computed, watch, ref, nextTick, type Ref } from 'vue';
import { useChat } from '~/composables/useAi';
import type { ChatMessage as ChatMessageType } from '~/utils/chat/types';
import VirtualMessageList from './VirtualMessageList.vue';
import { useAutoScroll } from '../../composables/useAutoScroll';
import { useElementSize } from '@vueuse/core';
import { isMobile } from '~/state/global';
import { onMounted, watchEffect } from 'vue';

// Debug utilities removed per request.

const model = ref('openai/gpt-oss-120b');
const pendingPromptId = ref<string | null>(null);

// Resize (Req 3.4): useElementSize -> reactive width
const containerRoot: Ref<HTMLElement | null> = ref(null);
const { width: containerWidth } = useElementSize(containerRoot);
// Dynamic chat input height to compute scroll padding
const chatInputEl: Ref<HTMLElement | null> = ref(null);
const { height: chatInputHeight } = useElementSize(chatInputEl);
// Live height emitted directly from component for more precise padding (especially during dynamic editor growth)
const emittedInputHeight = ref<number | null>(null);
const effectiveInputHeight = computed(
    () => emittedInputHeight.value || chatInputHeight.value || 140
);
// Extra scroll padding so list content isn't hidden behind input; add a little more on mobile
const bottomPad = computed(() => {
    const base = Math.round(effectiveInputHeight.value + 0);
    return isMobile.value ? base + 24 : base; // 24px approximates safe-area + gap
});

// Mobile fixed wrapper classes/styles
// Use fixed positioning on both mobile & desktop so top bars / multi-pane layout shifts don't push input off viewport.
const inputWrapperClass = computed(() =>
    isMobile.value
        ? 'pointer-events-none fixed inset-x-0 bottom-0 z-40'
        : // Desktop: keep input scoped to its pane container
          'pointer-events-none absolute inset-x-0 bottom-0 z-10'
);
const inputWrapperStyle = computed(() => ({}));
const innerInputContainerClass = computed(() =>
    isMobile.value
        ? 'pointer-events-none flex justify-center sm:pr-[11px] px-1 pb-[calc(env(safe-area-inset-bottom)+6px)]'
        : 'pointer-events-none flex justify-center sm:pr-[11px] px-1 pb-2'
);
function onInputResize(e: { height: number }) {
    emittedInputHeight.value = e?.height || null;
}

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
        if (newId && currentId && newId === currentId) {
            return;
        }
        // Free previous thread messages & abort any active stream before switching
        try {
            (chat.value as any)?.clear?.();
        } catch {}
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
        if (chat.value.loading.value) {
            return;
        }
        // Prefer to update the internal messages array directly to avoid remount flicker
        import('~/utils/chat/uiMessages').then(({ ensureUiMessage }) => {
            chat.value!.messages.value = (mh || []).map((m: any) =>
                ensureUiMessage(m)
            );
        });
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
// messages already normalized to UiChatMessage with .text in useChat composable
const messages = computed(() => chat.value.messages.value || []);
onMounted(() => {
    if (import.meta.dev) {
        const withHashes = messages.value.filter(
            (m: any) => m.file_hashes && m.file_hashes.length
        );
        console.debug('[ChatContainer.mounted] messages', {
            total: messages.value.length,
            withHashes: withHashes.length,
            sample: withHashes.slice(0, 3).map((m: any) => ({
                id: m.id,
                hashes: m.file_hashes,
                hasMarkdown: (m.text || '').includes('file-hash:'),
                textPreview: (m.text || '').slice(0, 120),
            })),
        });
    }
});
watchEffect(() => {
    if (!import.meta.dev) return;
    const count = messages.value.filter(
        (m: any) => m.file_hashes && m.file_hashes.length
    ).length;
    console.debug('[ChatContainer.watchEffect] message/hash state', {
        total: messages.value.length,
        withHashes: count,
    });
});
// Removed length logging watcher.
const loading = computed(() => chat.value.loading.value);

// Tail streaming now provided directly by useChat composable
const streamId = computed(() => chat.value.streamId.value);
const streamState = computed(() => chat.value.streamState);
const streamReasoning = computed(() => streamState.value?.reasoningText || '');
const tailDisplay = computed(() => streamState.value?.text || '');
// Removed tail char delta logging.
// Current thread id for this container (reactive)
const currentThreadId = computed(() => chat.value.threadId?.value);
// Tail active means stream not finalized
const streamActive = computed(() => !streamState.value?.finalized);
// Simplified streaming placeholder: only while active and we have an id + some text/reasoning OR prior message
const streamingMessage = computed<any | null>(() => {
    if (!streamActive.value) return null;
    if (!streamId.value) return null;
    const rawTail = tailDisplay.value || '';
    const reasoningTail = streamReasoning.value || '';
    if (!rawTail && !reasoningTail && messages.value.length === 0) return null;
    return {
        role: 'assistant',
        text: rawTail,
        id: 'tail-' + streamId.value,
        stream_id: streamId.value || undefined,
        pending: true,
        reasoning_text: reasoningTail,
    } as any;
});

// Hybrid virtualization: keep last N recent messages outside virtual list to avoid flicker near viewport
const RECENT_NON_VIRTUAL = 6;
function filterStreaming(arr: any[]) {
    if (streamActive.value && streamId.value) {
        return arr.filter((m) => m.stream_id !== streamId.value);
    }
    return arr;
}
const recentMessages = computed<any[]>(() => {
    const base = filterStreaming(messages.value);
    if (base.length <= RECENT_NON_VIRTUAL) return base;
    return base.slice(-RECENT_NON_VIRTUAL);
});
const virtualStableMessages = computed<any[]>(() => {
    const base = filterStreaming(messages.value);
    if (base.length <= RECENT_NON_VIRTUAL) return [];
    return base.slice(0, -RECENT_NON_VIRTUAL);
});
// Removed size change logging for virtual/recent message groups.

// Removed assistantVisible tracking (no handoff overlap needed)

// Scroll handling (Req 3.3) via useAutoScroll
const scrollParent: Ref<HTMLElement | null> = ref(null);
// Add disengageDeltaPx so a small upward scroll (8px) releases stickiness
// preventing jump-to-bottom when stream finalizes while user is reading.
// Explicit cast ensures consistent HTMLElement | null Ref type for the composable
const autoScroll = useAutoScroll(scrollParent as Ref<HTMLElement | null>, {
    thresholdPx: 64,
    disengageDeltaPx: 8,
});
// Unified scroll scheduling for streaming updates.
let scrollScheduled = false;
function scheduleScrollIfAtBottom() {
    if (!autoScroll.atBottom.value) return;
    // SSR safeguard: requestAnimationFrame not available server-side
    if (typeof requestAnimationFrame !== 'function') {
        // Fallback: run immediately (server render won't actually scroll but avoids crash)
        autoScroll.onContentIncrease();
        return;
    }
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
        scrollScheduled = false;
        autoScroll.onContentIncrease();
    });
}

// Initial bottom stick (client only; SSR lacks requestAnimationFrame)
if (process.client) {
    requestAnimationFrame(() => {
        if (autoScroll.atBottom.value)
            autoScroll.scrollToBottom({ smooth: false });
    });
}

// Consolidated scroll reactions (messages length, streaming version, input height changes, thread switch)
watchEffect(async () => {
    // Skip scroll scheduling during SSR (no DOM / rAF)
    if (typeof window === 'undefined') return;
    const deps = [
        messages.value.length,
        streamState.value?.version,
        chatInputHeight.value,
        emittedInputHeight.value,
        currentThreadId.value,
    ];
    void deps; // register dependencies
    await nextTick();
    if (autoScroll.atBottom.value) scheduleScrollIfAtBottom();
});

// (8.4) Auto-scroll already consolidated; tail growth handled via version watcher
// Chat send abstraction (Req 3.5)

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

    // Send message via useChat composable
    chat.value
        .sendMessage(payload.text, {
            model: model.value,
            files,
            file_hashes,
            extraTextParts,
            online: !!payload.webSearchEnabled,
        })
        .catch(() => {});
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
    msg.text = payload.content;
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

function onStopStream() {
    try {
        (chat.value as any)?.abort?.();
    } catch {}
}
</script>

<style>
/* Optional custom styles placeholder */
</style>
