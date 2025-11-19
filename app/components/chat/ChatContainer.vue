<template>
    <main
        ref="containerRoot"
        v-bind="containerProps"
        :class="[
            'chat-container-root flex w-full flex-1 h-full flex-col overflow-hidden relative',
            containerProps?.class ?? '',
        ]"
    >
        <!-- Scroll viewport -->
        <div
            ref="scrollParent"
            v-bind="scrollContainerProps"
            :class="[
                'chat-scroll-container w-full overflow-y-auto overscroll-contain px-[3px] sm:pt-3.5 scrollbars',
                scrollContainerProps?.class ?? '',
            ]"
            :style="scrollParentStyle"
        >
            <div
                v-bind="messageListProps"
                :class="[
                    'chat-message-list mx-auto w-full px-1.5 sm:max-w-[768px] pb-8 sm:pb-10 pt-safe-offset-10 flex flex-col',
                    messageListProps?.class ?? '',
                ]"
            >
                <!-- Virtualized stable messages (Req 3.1) -->
                <VirtualMessageList
                    class="virtual-message-list"
                    :messages="stableMessages"
                    :item-size-estimation="520"
                    :overscan="5"
                    :scroll-parent="scrollParent"
                    :is-streaming="streamActive"
                    :editing-active="anyEditing"
                    @scroll-state="onScrollState"
                    wrapper-class="virtual-message-list-wrapper flex flex-col"
                >
                    <template #item="{ message, index }">
                        <div
                            :key="message.id || message.stream_id || index"
                            class="messages-container not-first:group relative w-full max-w-full min-w-0 space-y-4 break-words"
                            :data-msg-id="message.id"
                            :data-stream-id="message.stream_id"
                        >
                            <LazyChatMessage
                                :message="message"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                                @begin-edit="onBeginEdit(message.id)"
                                @cancel-edit="onEndEdit(message.id)"
                                @save-edit="onEndEdit(message.id)"
                            />
                        </div>
                    </template>
                    <template #tail>
                        <!-- Streaming tail appended (Req 3.2) -->
                        <div
                            v-if="streamingMessage"
                            class="streaming-tail"
                            style="overflow-anchor: none"
                            ref="tailWrapper"
                        >
                            <LazyChatMessage
                                :message="streamingMessage as any"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                                @begin-edit="onBeginEdit(streamingMessage.id)"
                                @cancel-edit="onEndEdit(streamingMessage.id)"
                                @save-edit="onEndEdit(streamingMessage.id)"
                            />
                        </div>
                    </template>
                </VirtualMessageList>
            </div>
        </div>
        <!-- Input area overlay -->
        <div
            v-bind="inputWrapperProps"
            :class="[
                'chat-input-wrapper',
                inputWrapperClass,
                inputWrapperProps?.class ?? '',
            ]"
            :style="inputWrapperStyle"
        >
            <div
                v-bind="innerInputContainerProps"
                :class="[
                    'chat-inner-input-container',
                    innerInputContainerClass,
                    innerInputContainerProps?.class ?? '',
                ]"
            >
                <lazy-chat-input-dropper
                    :loading="loading"
                    :streaming="loading"
                    :container-width="containerWidth"
                    :thread-id="currentThreadId"
                    :pane-id="paneId"
                    @send="onSend"
                    @model-change="onModelChange"
                    @stop-stream="onStopStream"
                    @pending-prompt-selected="onPendingPromptSelected"
                    @resize="onInputResize"
                    class="chat-input pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
// Refactored ChatContainer (Task 4) – orchestration only.
// Reqs: 3.1,3.2,3.3,3.4,3.5,3.6,3.10,3.11
import {
    shallowRef,
    computed,
    watch,
    ref,
    type Ref,
    type CSSProperties,
} from 'vue';

import {
    getPanePendingPrompt,
    clearPanePendingPrompt,
    setPanePendingPrompt,
} from '~/composables/core/usePanePrompt';
import type { ChatMessage as ChatMessageType } from '~/utils/chat/types';
import VirtualMessageList from './VirtualMessageList.vue';
import { useElementSize } from '@vueuse/core';
import { isMobile } from '~/state/global';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { useThemeOverrides } from '~/composables/useThemeResolver';
// Removed onMounted/watchEffect (unused)

// Debug utilities removed per request.

const model = ref('openai/gpt-oss-120b');
const pendingPromptId = ref<string | null>(null);
//yoooolo
// Resize (Req 3.4): useElementSize -> reactive width
const containerRoot: Ref<HTMLElement | null> = ref(null);
const { width: containerWidth } = useElementSize(containerRoot);
// Live height emitted directly from component for more precise padding (especially during dynamic editor growth)
const emittedInputHeight = ref<number | null>(null);
// CLS fix: use a stable default height that matches typical input to prevent shift during initial render
// Conservative estimate for chat input (single line + padding + controls)
const DEFAULT_INPUT_HEIGHT = 140;
// Rely on emitted height; fallback to stable default when unavailable
const effectiveInputHeight = computed(
    () => emittedInputHeight.value ?? DEFAULT_INPUT_HEIGHT
);
// Extra scroll padding so list content isn't hidden behind input; add a little more on mobile
const bottomPad = computed(() => {
    const base = Math.round(effectiveInputHeight.value + 16); // Add 16px buffer
    return isMobile.value ? base + 24 : base; // 24px approximates safe-area + gap
});

// Use typed CSSProperties for template binding; overflowAnchor uses the proper union type
const scrollParentStyle = computed<CSSProperties>(() => ({
    paddingBottom: bottomPad.value + 'px',
    overflowAnchor: 'auto' as CSSProperties['overflowAnchor'],
}));

// Mobile fixed wrapper classes/styles
// Use fixed positioning on both mobile & desktop so top bars / multi-pane layout shifts don't push input off viewport.
// CLS fix: Reserve stable height to prevent layout shift when lazy input hydrates
const inputWrapperClass = computed(() =>
    isMobile.value
        ? 'pointer-events-none fixed inset-x-0 bottom-0 z-40'
        : // Desktop: keep input scoped to its pane container
          'pointer-events-none absolute inset-x-0 bottom-0 z-10'
);
const inputWrapperStyle = computed<CSSProperties>(() => ({
    minHeight: `${DEFAULT_INPUT_HEIGHT}px`, // Reserve space to prevent CLS
    // Prevent child content from changing wrapper height during hydration
    contain: 'layout' as const,
}));
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
    paneId?: string; // forwarded so ChatInputDropper can register with bridge
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
// Initialized defensively (HMR can briefly leave it null in re-eval window)
// If pane has a pending prompt selection (chosen before thread exists) seed it
if (props.paneId) {
    const pre = getPanePendingPrompt(props.paneId);
    if (pre) pendingPromptId.value = pre;
}
const chat = shallowRef<any>(
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
        // Filter out tool messages before updating
        chat.value!.messages.value = (mh || [])
            .filter((m: any) => m.role !== 'tool')
            .map((m: any) => ensureUiMessage(m));
    }
);

// When a new thread id is created internally (first send), propagate upward once
watch(
    () => chat.value?.threadId?.value,
    (id, prev) => {
        if (!prev && id) {
            emit('thread-selected', id);
            // Clear pending prompt (and pane-level cached) since it's applied
            if (props.paneId) clearPanePendingPrompt(props.paneId);
            pendingPromptId.value = null;
        }
    }
);

// Render messages with content narrowed to string for ChatMessage.vue
// messages already normalized to UiChatMessage with .text in useChat composable
// Filter out tool messages (internal implementation details shown inline in assistant messages)
const messages = computed(() =>
    (chat.value?.messages?.value || []).filter((m: any) => m.role !== 'tool')
);

const loading = computed(() => chat.value?.loading?.value || false);

// Tail streaming now provided directly by useChat composable
// `useChat` returns many refs; unwrap common ones so computed values expose plain objects/primitives
const streamId = computed(() => {
    const s = chat.value?.streamId;
    return s && 'value' in s ? (s as any).value : s;
});
const streamState: any = computed(() => {
    const s = chat.value?.streamState;
    return s && 'value' in s ? (s as any).value : s;
});
// Stream text + reasoning (from unified stream accumulator)
// Tail assistant from composable (kept out of history until next user send)
const tailAssistant = computed<any | null>(() => {
    const t = chat.value?.tailAssistant;
    return t && 'value' in t ? (t as any).value : t;
});
// Live streaming deltas (while active) to overlay into tailAssistant
const streamReasoning = computed(
    () => streamState?.value?.reasoningText || streamState?.reasoningText || ''
);
const tailDisplay = computed(
    () => streamState?.value?.text || streamState?.text || ''
);
// Removed tail char delta logging.
// Current thread id for this container (reactive)
const currentThreadId = computed(() => chat.value?.threadId?.value);
// Tail active means stream not finalized
const streamActive = computed(
    () => !(streamState?.value?.finalized ?? streamState?.finalized ?? false)
);
// Display logic: if tailAssistant exists, use it; merge live accumulator text while active.
const streamingMessage = computed<any | null>(() => {
    const base = tailAssistant.value;
    if (!base) return null;
    const active = streamActive.value && streamId.value;
    if (!active) return base; // finalized: use original object so edits persist
    const text = tailDisplay.value || base.text;
    const reasoning = streamReasoning.value || base.reasoning_text;
    return Object.assign({}, base, {
        text,
        reasoning_text: reasoning,
        pending: base.pending && !(text || reasoning),
    });
});

// All stable messages (excluding the in-flight streaming tail) are virtualized to avoid boundary jumps
// messages[] already excludes tail assistant; no filtering required
const stableMessages = computed<any[]>(() => messages.value);
// Removed size change logging for virtual/recent message groups.

// Removed assistantVisible tracking (no handoff overlap needed)

// Scroll handling centralized in VirtualMessageList
const scrollParent: Ref<HTMLElement | null> = ref(null);
// Track editing state across child messages for scroll suppression (Task 5.2.2)
const editingIds = ref<Set<string>>(new Set());
const anyEditing = computed(() => editingIds.value.size > 0);
function onBeginEdit(id: string) {
    if (!id) return;
    if (!editingIds.value.has(id)) {
        editingIds.value = new Set(editingIds.value).add(id);
    }
}
function onEndEdit(id: string) {
    if (!id) return;
    if (editingIds.value.has(id)) {
        const next = new Set(editingIds.value);
        next.delete(id);
        editingIds.value = next;
    }
}
// Scroll state from VirtualMessageList (Task 5.1.2)
const atBottom = ref(true);
const stick = ref(true);
function onScrollState(s: { atBottom: boolean; stick: boolean }) {
    atBottom.value = s.atBottom;
    stick.value = s.stick;
}

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
        type: img.file?.type || img.mime || 'image/png',
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
        ?.sendMessage(payload.text, {
            model: model.value,
            files,
            file_hashes,
            extraTextParts,
            online: !!payload.webSearchEnabled,
        })
        ?.catch(() => {});
}

function onRetry(messageId: string) {
    if (!chat.value || chat.value?.loading?.value) return;
    // Provide current model so retry uses same selection
    (chat.value as any).retryMessage(messageId, model.value);
}

function onBranch(newThreadId: string) {
    if (newThreadId) emit('thread-selected', newThreadId);
}

function onEdited(payload: { id: string; content: string }) {
    if (!chat.value) return;
    const arr = chat.value?.messages?.value;
    if (arr) {
        const idx = arr.findIndex((m: any) => m.id === payload.id);
        if (idx !== -1) {
            const msg = arr[idx];
            if (msg) msg.text = payload.content;
            chat.value.messages.value = [...arr];
            return;
        }
    }
    // Tail assistant edit (not yet flushed)
    const ta = (chat.value as any).tailAssistant?.value;
    if (ta && ta.id === payload.id) {
        ta.text = payload.content;
    }
}

function onPendingPromptSelected(promptId: string | null) {
    pendingPromptId.value = promptId;
    // Store pane-level until thread creation
    if (props.paneId) {
        setPanePendingPrompt(props.paneId, promptId);
    }
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

// Theme overrides
const containerProps = useThemeOverrides({
    component: 'div',
    context: 'chat',
    identifier: 'chat.container',
    isNuxtUI: false,
});

const scrollContainerProps = useThemeOverrides({
    component: 'div',
    context: 'chat',
    identifier: 'chat.scroll-container',
    isNuxtUI: false,
});

const messageListProps = useThemeOverrides({
    component: 'div',
    context: 'chat',
    identifier: 'chat.message-list',
    isNuxtUI: false,
});

const inputWrapperProps = useThemeOverrides({
    component: 'div',
    context: 'chat',
    identifier: 'chat.input-wrapper',
    isNuxtUI: false,
});

const innerInputContainerProps = useThemeOverrides({
    component: 'div',
    context: 'chat',
    identifier: 'chat.inner-input-container',
    isNuxtUI: false,
});
</script>

<style>
/* Optional custom styles placeholder */
</style>
