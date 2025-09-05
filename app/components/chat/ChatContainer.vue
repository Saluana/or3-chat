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
                class="mx-auto w-full px-1.5 sm:max-w-[768px] pb-10 pt-safe-offset-10 flex flex-col"
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
                                :message="message as RenderMessage"
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
                                :message="rm as RenderMessage"
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
import { shallowRef, computed, watch, ref, nextTick, watchEffect } from 'vue';
import { parseFileHashes } from '~/db/files-util';
import { useChat } from '~/composables/useAi';
import type {
    ChatMessage as ChatMessageType,
    ContentPart,
} from '~/utils/chat/types';
import VirtualMessageList from './VirtualMessageList.vue';
// (Tail streaming integrated into useChat; legacy useTailStream removed)
import { useAutoScroll } from '../../composables/useAutoScroll';
import { useRafBatch } from '~/composables/useRafBatch';
import { useElementSize } from '@vueuse/core';
import { isMobile } from '~/state/global';

// Debug utilities removed per request.

const model = ref('openai/gpt-oss-120b');
const pendingPromptId = ref<string | null>(null);

// Resize (Req 3.4): useElementSize -> reactive width
const containerRoot = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(containerRoot);
// Dynamic chat input height to compute scroll padding
const chatInputEl = ref<HTMLElement | null>(null);
const { height: chatInputHeight } = useElementSize(chatInputEl);
// Live height emitted directly from component for more precise padding (especially during dynamic editor growth)
const emittedInputHeight = ref<number | null>(null);
const effectiveInputHeight = computed(
    () => emittedInputHeight.value || chatInputHeight.value || 140
);
// Extra scroll padding so list content isn't hidden behind input; add a little more on mobile
const bottomPad = computed(() => {
    const base = Math.round(effectiveInputHeight.value + 36);
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
    // Required id for virtualization; fallback synthesized if source missing
    id: string;
    stream_id?: string;
    file_hashes?: string | null;
    pending?: boolean;
    reasoning_text?: string | null;
};

const messages = computed<RenderMessage[]>(() =>
    (chat.value.messages.value || []).map(
        (m: ChatMessageType & any, i: number) => {
            let contentStr = '';
            if (typeof m.content === 'string') {
                contentStr = m.content; // already markdown or plain text
                // If this is an assistant message with persisted images (file_hashes) but
                // the stored content is only text (no inline images), append markdown placeholders
                // so ChatMessage can hydrate them.
                if (
                    m.role === 'assistant' &&
                    (m as any).file_hashes &&
                    !/file-hash:/i.test(contentStr)
                ) {
                    try {
                        const hashes =
                            parseFileHashes((m as any).file_hashes) || [];
                        if (hashes.length) {
                            const placeholders = hashes.map(
                                (h: string) =>
                                    `![generated image](file-hash:${h})`
                            );
                            // Only append if no existing image markdown already present
                            const hasImageMarkdown =
                                /!\[[^\]]*\]\((?:data:image|file-hash:|https?:)/i.test(
                                    contentStr
                                );
                            if (!hasImageMarkdown) {
                                contentStr +=
                                    (contentStr ? '\n\n' : '') +
                                    placeholders.join('\n\n');
                            }
                        }
                    } catch {}
                }
            } else if (Array.isArray(m.content)) {
                const segs: string[] = [];
                let imageCount = 0;
                for (const p of m.content as ContentPart[]) {
                    if (p.type === 'text') {
                        segs.push(p.text);
                    } else if (p.type === 'image') {
                        const src = typeof p.image === 'string' ? p.image : '';
                        if (src) {
                            // Always inject as markdown image so ChatMessage StreamMarkdown handles it.
                            segs.push(`![generated image](${src})`);
                            imageCount++;
                        }
                    } else if (p.type === 'file') {
                        const label = (p as any).name || p.mediaType || 'file';
                        segs.push(`**[file:${label}]**`);
                    }
                }
                // If no actual image parts present but we have stored file hashes (persisted images), add markdown placeholders so hydration can swap later.
                if (imageCount === 0 && (m as any).file_hashes) {
                    const hashes =
                        parseFileHashes((m as any).file_hashes) || [];
                    if (hashes.length) {
                        hashes.forEach((h: string) => {
                            segs.push(`![generated image](file-hash:${h})`);
                        });
                    }
                }
                contentStr = segs.join('\n\n');
            } else {
                contentStr = String((m as any).content ?? '');
            }
            const rawReasoning =
                (m as any).reasoning_text ||
                (m as any).data?.reasoning_text ||
                null;
            return {
                role: m.role,
                content: contentStr,
                id: (m.id || m.stream_id || 'm' + i) + '',
                stream_id: m.stream_id,
                file_hashes: (m as any).file_hashes,
                pending: (m as any).pending,
                reasoning_text: rawReasoning,
            } as RenderMessage;
        }
    )
);
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
// Tail active means: actively streaming OR (reasoning still present and not finalized)
const finalizedOnce = ref(false);
const streamActive = computed(() => !streamState.value?.finalized);
// Unified streaming message (8.2)
const streamingMessage = computed<RenderMessage | null>(() => {
    const anyMsgs = messages.value.length > 0;
    const rawTail = tailDisplay.value || '';
    const reasoningTail = streamReasoning.value || '';
    const hasTail = rawTail.length > 0 || reasoningTail.length > 0;

    // Active stream: show if we have a stream id and either some tail tokens OR at least one prior message (user just sent one).
    if (streamActive.value) {
        if (!streamId.value) return null;
        if (!hasTail && !anyMsgs) return null; // blank brand-new chat before first token
    } else if (handoff.value) {
        // One-frame overlap after finalize; only if there was content and not already fully removed.
        if (!hasTail || finalizedOnce.value) return null;
    } else {
        return null; // neither active nor handoff
    }

    return {
        role: 'assistant',
        content: rawTail,
        id: streamId.value ? 'tail-' + streamId.value : 'tail-stream',
        stream_id: streamId.value || undefined,
        pending: streamActive.value,
        reasoning_text: reasoningTail,
    } as RenderMessage;
});
// Pre-render support for seamless handoff
const handoff = ref(false); // one-frame overlap flag; now only rendered if tail had content
const assistantVisible = ref(false); // detection of assistant row presence post-stream
const tailWrapper = ref<HTMLElement | null>(null);
const FINALIZE_LEN_SINGLE_RAF = 4000;
const FINALIZE_LEN_DOUBLE_RAF = 12000; // removed height lock tracking & tailContent

// Hybrid virtualization: keep last N recent messages outside virtual list to avoid flicker near viewport
const RECENT_NON_VIRTUAL = 6;
function filterStreaming(arr: RenderMessage[]) {
    if (streamActive.value && streamId.value && !handoff.value) {
        return arr.filter((m) => m.stream_id !== streamId.value);
    }
    return arr;
}
const recentMessages = computed<RenderMessage[]>(() => {
    const base = filterStreaming(messages.value);
    if (base.length <= RECENT_NON_VIRTUAL) return base;
    return base.slice(-RECENT_NON_VIRTUAL);
});
const virtualStableMessages = computed<RenderMessage[]>(() => {
    const base = filterStreaming(messages.value);
    if (base.length <= RECENT_NON_VIRTUAL) return [];
    return base.slice(0, -RECENT_NON_VIRTUAL);
});
// Removed size change logging for virtual/recent message groups.

// Track when the assistant streaming message (by stream_id) is actually present in virtual list
watch([virtualStableMessages, recentMessages, streamId, streamActive], () => {
    if (!streamId.value) return;
    const present =
        recentMessages.value.some((m: any) => m.stream_id === streamId.value) ||
        virtualStableMessages.value.some(
            (m: any) => m.stream_id === streamId.value
        );
    if (present !== assistantVisible.value) assistantVisible.value = present;
});

// Scroll handling (Req 3.3) via useAutoScroll
const scrollParent = ref<HTMLElement | null>(null);
// Add disengageDeltaPx so a small upward scroll (8px) releases stickiness
// preventing jump-to-bottom when stream finalizes while user is reading.
const autoScroll = useAutoScroll(scrollParent, {
    thresholdPx: 64,
    disengageDeltaPx: 8,
});
// Removed standalone messages.length watcher (handled in unified watchEffect)
// Unified scroll scheduling for streaming updates.
// Prior version stacked nextTick + rAF + nextTick creating visible lag.
let scrollScheduled = false;
function scheduleScrollIfAtBottom() {
    if (!autoScroll.atBottom.value) {
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

// Replace multiple tail / input / thread watchers with a single watchEffect.
let prev = {
    len: 0,
    version: 0,
    inputH: 0,
    emittedH: 0,
    thread: '' as string | undefined,
    wasActive: false,
};
watchEffect(async () => {
    const len = messages.value.length;
    const version = streamState.value?.version || 0;
    const inputH = chatInputHeight.value || 0;
    const emittedH = emittedInputHeight.value || 0;
    const thread = currentThreadId.value;
    const active = streamActive.value;

    const countChanged = len !== prev.len;
    const versionChanged = version !== prev.version;
    const inputChanged = inputH !== prev.inputH || emittedH !== prev.emittedH;
    const threadChanged = thread !== prev.thread;
    const activeChanged = active !== prev.wasActive;

    // Scroll on new content tokens or structural changes if user at bottom.
    if (autoScroll.atBottom.value && (countChanged || versionChanged)) {
        await nextTick();
        scheduleScrollIfAtBottom();
    }
    // Input height adjustments: keep pinned without smooth snap.
    if (autoScroll.atBottom.value && inputChanged) {
        await nextTick();
        autoScroll.scrollToBottom({ smooth: false });
    }
    // Thread switch: attempt to preserve bottom stick if user was at bottom.
    if (threadChanged) {
        await nextTick();
        if (autoScroll.atBottom.value) scheduleScrollIfAtBottom();
    }
    // Stream finalize transition (active->inactive): previous logic moved here.
    if (!active && prev.wasActive) {
        // Stream ended: start overlap (no pre-render HTML now)
        const sid = streamId.value;
        if (sid) {
            const target = (chat.value.messages.value as any[])
                .slice()
                .reverse()
                .find((m) => m.stream_id === sid);
            if (target) {
                // We deliberately do NOT set pre_html anymore; ChatMessage consumes raw markdown
            }
        }
        // If user is not truly at bottom (released stick via upward scroll) ensure
        // we don't force snap during handoff. Release sticky just in case.
        if (!autoScroll.atBottom.value) {
            autoScroll.release();
        }
        handoff.value = true; // keep tail while assistant row enters

        // Decide finalize strategy
        const len = (tailDisplay.value || '').length;
        let strategy: 'sync' | 'single-raf' | 'double-raf' = 'single-raf';
        if (assistantVisible.value) strategy = 'sync';
        else if (len >= FINALIZE_LEN_DOUBLE_RAF) strategy = 'double-raf';
        else if (len < FINALIZE_LEN_SINGLE_RAF) strategy = 'single-raf';

        // Capture tail height for smooth swap (prevents collapse flash)
        let tailHeight = 0;
        if (tailWrapper.value) {
            tailHeight = tailWrapper.value.offsetHeight;
        }

        // Wait until assistant row detected, then allow two frames before removing tail
        const finalize = () => {
            const performRemoval = () => {
                handoff.value = false;
                finalizedOnce.value = true; // prevent reasoning-only tail reappearing
            };
            // Apply height lock to final assistant element if we captured and not yet applied
            if (tailHeight > 0) {
                requestAnimationFrame(() => {
                    const container = containerRoot.value;
                    if (container) {
                        const selector = `[data-stream-id="${sid}"]`;
                        const finalEl = container.querySelector(
                            selector
                        ) as HTMLElement | null;
                        if (finalEl) {
                            finalEl.style.minHeight = tailHeight + 'px';
                            requestAnimationFrame(() => {
                                finalEl.style.removeProperty('min-height');
                            });
                        }
                    }
                });
            }
            if (strategy === 'sync') {
                performRemoval();
            } else if (strategy === 'single-raf') {
                requestAnimationFrame(() => {
                    performRemoval();
                });
            } else {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        performRemoval();
                    });
                });
            }
        };
        if (assistantVisible.value) {
            finalize();
        } else {
            const stopWatch = watch(assistantVisible, (v) => {
                if (v) {
                    stopWatch();
                    finalize();
                }
            });
        }
    }
    // New stream started: reset finalizedOnce.
    if (active && !prev.wasActive) finalizedOnce.value = false;

    prev = { len, version, inputH, emittedH, thread, wasActive: active };
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
