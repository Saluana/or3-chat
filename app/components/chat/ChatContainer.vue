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
                                :message="message as RenderMessage"
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
                            <ChatMessage
                                :message="{
                                    role: 'assistant',
                                    content: tailContent,
                                    stream_id: tailStreamId,
                                    pending: true,
                                    reasoning_text: tailReasoning || '',
                                } as any"
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
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center sm:pr-[11px] px-1"
            >
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
// (Tail streaming integrated into useChat; legacy useTailStream removed)
import { useAutoScroll } from '../../composables/useAutoScroll';
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
    file_hashes?: string | null;
    pending?: boolean;
    reasoning_text?: string | null;
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
        const rawReasoning =
            (m as any).reasoning_text ??
            (m as any).data?.reasoning_text ??
            null;

        return {
            role: m.role,
            content: contentStr,
            id: m.id,
            stream_id: m.stream_id,
            file_hashes: (m as any).file_hashes,
            pending: (m as any).pending,
            reasoning_text: rawReasoning,
        } as RenderMessage;
    })
);
const loading = computed(() => chat.value.loading.value);

// Tail streaming now provided directly by useChat composable
const tailStreamId = computed(() => chat.value.streamId.value);
const tailReasoning = computed(() => chat.value.streamReasoning.value);
const tailDisplay = computed(() => chat.value.streamDisplayText.value);
// Current thread id for this container (reactive)
const currentThreadId = computed(() => chat.value.threadId?.value);
const tailActive = computed(
    () => chat.value.streamActive.value || !!tailReasoning.value
);
// Single content computed for tail ChatMessage
const tailContent = computed(() => {
    if (tailDisplay.value) return marked.parse(tailDisplay.value);
    // When no display text yet, leave content empty so ChatMessage shows loader component
    return '';
});

// Virtual list data excludes streaming assistant (Req 3.2 separation)
const virtualMessages = computed(() => {
    if (!tailActive.value || !tailStreamId.value) {
        return messages.value.map((m, i) => ({ ...m, id: m.id || String(i) }));
    }
    return messages.value
        .filter((m) => m.stream_id !== tailStreamId.value)
        .map((m, i) => ({ ...m, id: m.id || String(i) }));
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
// Unified scroll scheduling for tail updates
let scrollScheduled = false;
function scheduleScrollIfAtBottom() {
    if (!autoScroll.atBottom.value) return;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
        scrollScheduled = false;
        nextTick(() => autoScroll.onContentIncrease());
    });
}

// Initial bottom stick after mount (defer to allow user immediate scroll cancel)
nextTick(() => {
    setTimeout(() => {
        if (autoScroll.atBottom.value)
            autoScroll.scrollToBottom({ smooth: false });
    }, 0);
});

// Hook: streaming delta buffering
// Hooks no longer needed for streaming tail display; scroll on reactive tail changes
watch(
    () => [tailDisplay.value, tailReasoning.value],
    () => scheduleScrollIfAtBottom()
);
watch(
    () => chat.value.streamActive.value,
    (active) => active && scheduleScrollIfAtBottom()
);
watch(currentThreadId, () => {
    // Clear computed tail when switching threads (stream refs reset inside useChat later)
    scheduleScrollIfAtBottom();
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
        .catch((e: any) =>
            console.error('[ChatContainer.onSend] sendMessage error', e)
        );
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

function onStopStream() {
    try {
        (chat.value as any)?.abort?.();
    } catch {}
}
</script>

<style>
/* Optional custom styles placeholder */
</style>
