<template>
    <main
        ref="containerRoot"
        v-bind="containerProps"
        :class="[
            'chat-container-root flex w-full flex-1 h-full flex-col overflow-hidden relative',
            containerProps?.class ?? '',
        ]"
    >
        <!-- Virtualized messages (Req 3.1) -->
        <!-- Or3Scroll is now the scroll container -->
        <!-- Virtualized messages (Req 3.1) -->
        <!-- Or3Scroll is now the scroll container -->
        <ClientOnly>
            <Or3Scroll
                ref="scroller"
                :items="allMessages"
                :item-key="(m) => m.id || m.stream_id || ''"
                :estimate-height="80"
                :overscan="5500"
                :maintain-bottom="!anyEditing"
                :bottom-threshold="5"
                :padding-bottom="bottomPad"
                :padding-top="28"
                class="chat-message-list"
                :style="scrollParentStyle"
                @scroll="onScroll"
                @reachTop="emit('reached-top')"
                @reachBottom="emit('reached-bottom')"
            >
                <template #default="{ item, index }">
                    <div
                        :key="item.id || item.stream_id || index"
                        class="messages-container mx-auto sm:max-w-[768px] px-1.5 pb-6 not-first:group relative w-full min-w-0 break-words"
                        :data-msg-id="item.id"
                        :data-stream-id="item.stream_id"
                    >
                        <LazyChatMessage
                            :message="item"
                            :thread-id="props.threadId"
                            @retry="onRetry"
                            @continue="onContinue"
                            @branch="onBranch"
                            @edited="onEdited"
                            @begin-edit="onBeginEdit(item.id)"
                            @cancel-edit="onEndEdit(item.id)"
                            @save-edit="onEndEdit(item.id)"
                        />
                    </div>
                </template>
            </Or3Scroll>
        </ClientOnly>

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
                    'relative',
                ]"
            >
                <div
                    class="absolute bottom-full left-0 right-0 mb-2 flex justify-center pointer-events-none transition-opacity duration-200"
                    :style="{ opacity: scrollToBottomOpacity }"
                    v-show="isScrollable && distanceFromBottom > 1"
                >
                    <UButton
                        v-bind="scrollToBottomButtonProps"
                        @click="scrollToBottom"
                        class="pointer-events-auto"
                    />
                </div>
                <lazy-chat-input-dropper
                    :loading="loading"
                    :streaming="streamingActive"
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
    reactive,
    type Ref,
    type CSSProperties,
    onBeforeUnmount,
    nextTick,
} from 'vue';

import {
    getPanePendingPrompt,
    clearPanePendingPrompt,
    setPanePendingPrompt,
} from '~/composables/core/usePanePrompt';
import type { ChatMessage as ChatMessageType } from '~/utils/chat/types';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import { useElementSize } from '@vueuse/core';
import { isMobile } from '~/state/global';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useToast, useHooks } from '#imports';
import { MAX_MESSAGE_FILE_HASHES } from '~/db/files-util';
import type {
    ChatInstance,
    ImageAttachment,
    LargeTextAttachment,
    StreamState,
} from '../../../types/chat-internal';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
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
// Account for action buttons that extend below message containers (translate-y-1/2)
const bottomPad = computed(() => {
    const base = Math.round(effectiveInputHeight.value + 84); // Increased buffer for action buttons
    return isMobile.value ? base + 24 : base; // 24px approximates safe-area + gap
});

// Use typed CSSProperties for template binding
const scrollParentStyle = computed<CSSProperties>(() => ({
    scrollbarGutter: 'stable', // Prevent layout shift when scrollbar appears
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
    (e: 'reached-top'): void;
    (e: 'reached-bottom'): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
// Initialized defensively (HMR can briefly leave it null in re-eval window)
// If pane has a pending prompt selection (chosen before thread exists) seed it
if (props.paneId) {
    const pre = getPanePendingPrompt(props.paneId);
    if (pre) pendingPromptId.value = pre;
}
const chat = shallowRef<ChatInstance>(
    useChat(
        props.messageHistory,
        props.threadId,
        pendingPromptId.value || undefined
    ) as ChatInstance
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
            chat.value?.clear?.();
        } catch (e) {
            if (import.meta.dev) {
                console.warn(
                    '[ChatContainer] clear failed during thread switch',
                    e
                );
            }
        }
        chat.value = useChat(
            props.messageHistory,
            newId,
            pendingPromptId.value || undefined
        ) as ChatInstance;
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
            .filter((m) => m.role !== 'tool')
            .map((m) => ensureUiMessage(m));
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
const messages = computed<UiChatMessage[]>(
    () => chat.value?.messages?.value || []
);

const loading = computed(() => chat.value?.loading?.value || false);
const workflowRunning = computed(() => {
    for (const wf of workflowStates.values()) {
        if (wf && wf.executionState === 'running') return true;
    }
    return false;
});
const streamingActive = computed(() => loading.value || workflowRunning.value);

// Tail streaming now provided directly by useChat composable
// `useChat` returns many refs; unwrap common ones so computed values expose plain objects/primitives
function unwrapRef<T>(refOrValue: T | Ref<T>): T {
    return refOrValue && typeof refOrValue === 'object' && 'value' in refOrValue
        ? (refOrValue as Ref<T>).value
        : (refOrValue as T);
}

const streamId = computed(() => unwrapRef(chat.value?.streamId));
const streamState = computed<StreamState | null>(
    () => chat.value?.streamState ?? null
);
// Stream text + reasoning (from unified stream accumulator)
// Tail assistant from composable (kept out of history until next user send)
const tailAssistant = computed<UiChatMessage | null>(() => {
    const t = chat.value?.tailAssistant as
        | Ref<UiChatMessage | null>
        | UiChatMessage
        | null
        | undefined;
    return unwrapRef<UiChatMessage | null>(t ?? null);
});
// Live streaming deltas (while active) to overlay into tailAssistant
const streamReasoning = computed(() => streamState.value?.reasoningText || '');
const tailDisplay = computed(() => streamState.value?.text || '');
// Removed tail char delta logging.
// Current thread id for this container (reactive)
const currentThreadId = computed(() => chat.value?.threadId?.value);
// Tail active means stream not finalized
const streamActive = computed(() => !(streamState.value?.finalized ?? false));
// Display logic: if tailAssistant exists, use it; merge live accumulator text while active.
const streamingMessage = computed<UiChatMessage | null>(() => {
    const base = tailAssistant.value;
    if (!base) return null;
    const active = streamActive.value && streamId.value;
    if (!active) return base; // finalized: use original object so edits persist
    const text = tailDisplay.value || base.text;
    const reasoning = streamReasoning.value || base.reasoning_text || null;
    return {
        ...base,
        text,
        reasoning_text: reasoning,
        pending: base.pending && !(text || reasoning),
        stream_id: streamId.value, // Ensure stream_id is present for keying
    };
});

// All stable messages (excluding the in-flight streaming tail) are virtualized to avoid boundary jumps
// messages[] already excludes tail assistant; no filtering required
const stableMessages = computed<UiChatMessage[]>(() => messages.value);

// Combine stable messages and streaming message for Or3Scroll
// Reactive bridge: track workflow states by message id
const workflowStates = reactive(new Map<string, any>());

// Seed workflow state map from loaded messages so reloads show correct status
watch(
    () => messages.value,
    (list) => {
        if (!Array.isArray(list)) return;
        for (const msg of list) {
            const wf = (msg as any).workflowState;
            if (!wf) continue;
            const existing = workflowStates.get(msg.id);
            const existingVersion = existing?.version ?? -1;
            const nextVersion = wf.version ?? 0;
            if (!existing || nextVersion > existingVersion) {
                workflowStates.set(msg.id, wf);
            }
        }
    },
    { immediate: true }
);

function deriveWorkflowText(wf: any): string {
    if (!wf) return '';
    // Only return finalOutput - never show intermediate node outputs
    // The result box is controlled by WorkflowChatMessage using workflowState.finalOutput directly
    if (wf.finalOutput) return wf.finalOutput;
    return '';
}

function mergeWorkflowState(msg: UiChatMessage) {
    const wf = workflowStates.get(msg.id);
    if (!wf) return msg;
    const version = wf.version ?? 0; // Depend on version for reactivity
    const workflowText = deriveWorkflowText(wf);
    const pending = wf.executionState === 'running';
    return {
        ...msg,
        isWorkflow: true,
        workflowState: wf,
        text: workflowText, // never fall back to original message content
        pending,
        _wfVersion: version,
    } as UiChatMessage & { _wfVersion: number };
}

const allMessages = computed(() => {
    if (!chat.value) return [];
    const list = stableMessages.value.map(mergeWorkflowState);
    if (streamingMessage.value) {
        list.push(mergeWorkflowState(streamingMessage.value));
    }
    return list;
});

// Detect images in assistant messages to boost overscan (Req: User Request)
// Removed dynamic overscan in favor of static high overscan (6500px) for performance stability.

// Scroll handling centralized in VirtualMessageList
// Ref is now the VirtualMessageList component instance, not a raw element
type ScrollApi = {
    scrollToBottom?: (opts?: { smooth?: boolean }) => void;
    refreshMeasurements?: () => void;
};
const scroller = ref<ScrollApi | null>(null);

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
const distanceFromBottom = ref(0);
const isScrollable = ref(false);
const iconScrollToBottom = useIcon('chat.scrollToBottom');

const scrollToBottomButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'chat',
        identifier: 'chat.scroll-to-bottom',
        isNuxtUI: true,
    });

    return {
        icon: iconScrollToBottom.value || 'heroicons:arrow-down-20-solid',
        size: 'sm' as const,
        color: 'primary' as const,
        variant: 'solid' as const,
        ui: { base: 'rounded-full' },
        class: 'shadow-lg',
        ...overrides.value,
    };
});

const scrollToBottomOpacity = computed(() => {
    // Transition into view as we scroll up
    return Math.min(1, distanceFromBottom.value / 150);
});

function scrollToBottom() {
    scroller.value?.scrollToBottom?.({ smooth: true });
}

function onScrollState(s: { atBottom: boolean; stick: boolean }) {
    atBottom.value = s.atBottom;
    stick.value = s.stick;
}

function onScroll(payload: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    isAtBottom: boolean;
}) {
    atBottom.value = payload.isAtBottom;
    distanceFromBottom.value =
        payload.scrollHeight - payload.scrollTop - payload.clientHeight;
    isScrollable.value = payload.scrollHeight > payload.clientHeight;

    // Simple stick logic: if we are at bottom, we stick. If user scrolls up, we unstick.
    if (payload.isAtBottom) {
        stick.value = true;
    } else {
        stick.value = false;
    }

    // We can emit scroll state if parent needs it, but here we ARE the parent.
    // Logic that depended on 'scroll-state' event can now use local refs directly.
}

// (8.4) Auto-scroll already consolidated; tail growth handled via version watcher
// Chat send abstraction (Req 3.5)
const toast = useToast();

function collectRecentHashes(limit = MAX_MESSAGE_FILE_HASHES): string[] {
    const msgs = chat.value?.messages?.value || [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = msgs.length - 1; i >= 0 && out.length < limit; i--) {
        const m = msgs[i];
        if (!m || !Array.isArray(m.file_hashes)) continue;
        for (const h of m.file_hashes) {
            if (!h || seen.has(h)) continue;
            seen.add(h);
            out.push(h);
            if (out.length >= limit) break;
        }
    }
    return out;
}

type UploadedImage = {
    file: File;
    url: string;
    name: string;
    hash?: string;
    status: 'pending' | 'ready' | 'error';
    error?: string;
    mime: string;
    kind: 'image' | 'pdf';
};

type ChatInputSendPayload = {
    text: string;
    images: UploadedImage[];
    attachments: UploadedImage[];
    largeTexts: LargeTextAttachment[];
    model: string;
    settings: {
        quality: 'low' | 'medium' | 'high';
        numResults: number;
        size: '1024x1024' | '1024x1536' | '1536x1024';
    };
    webSearchEnabled: boolean;
};

function onSend(payload: ChatInputSendPayload) {
    if (loading.value) return;
    model.value = payload.model || model.value;
    const attachments = payload.attachments?.length
        ? payload.attachments
        : payload.images;
    const readyImages =
        attachments?.filter(
            (img): img is UploadedImage =>
                Boolean(img) && img.status === 'ready'
        ) ?? [];
    const pendingCount =
        attachments?.filter(
            (img): img is UploadedImage =>
                Boolean(img) && img.status === 'pending'
        ).length ?? 0;

    if (pendingCount > 0) {
        // Defer sending until attachments finish hashing to avoid losing them
        toast?.add?.({
            title: 'Files are still uploading',
            description: 'Please wait for attachments to finish.',
            color: 'primary',
            duration: 2400,
        });
        return;
    }
    const carryHashes = readyImages.length === 0 ? collectRecentHashes() : [];
    const files = readyImages
        .map((img) => {
            const url = img.hash || img.url;
            if (!url) return null;
            return {
                type: img.file?.type || img.mime || 'image/png',
                url,
            };
        })
        .filter(
            (
                f
            ): f is {
                type: string;
                url: string;
            } => Boolean(f)
        );
    const file_hashes = readyImages
        .map((img) => img.hash)
        .filter((h): h is string => typeof h === 'string');
    const context_hashes = carryHashes.filter(
        (h): h is string => typeof h === 'string'
    );
    const extraTextParts =
        payload.largeTexts
            ?.map((t: LargeTextAttachment) => t.text)
            .filter(Boolean) ?? [];

    // Send message via useChat composable
    chat.value
        ?.send({
            content: payload.text,
            model: payload.model || model.value,
            files,
            file_hashes,
            extraTextParts,
            online: !!payload.webSearchEnabled,
            context_hashes,
        })
        ?.then(() => {
            // Ensure layout is stable after sending (input shrink + new message)
            nextTick(() => scroller.value?.refreshMeasurements?.());
        })
        ?.catch(() => {});
}

function onRetry(messageId: string) {
    if (!chat.value || chat.value?.loading?.value) return;
    // Provide current model so retry uses same selection
    chat.value.retryMessage(messageId, model.value);
    // Retry changes message state, force measure
    nextTick(() => scroller.value?.refreshMeasurements?.());
}

function onContinue(messageId: string) {
    if (!chat.value || chat.value?.loading?.value) return;
    chat.value.continueMessage?.(messageId, model.value);
    nextTick(() => scroller.value?.refreshMeasurements?.());
}

function onBranch(newThreadId: string) {
    if (newThreadId) emit('thread-selected', newThreadId);
}

function onEdited(payload: { id: string; content: string }) {
    if (!chat.value) return;
    const applied =
        typeof chat.value.applyLocalEdit === 'function'
            ? chat.value.applyLocalEdit(payload.id, payload.content)
            : false;
    if (applied) {
        // Content changed size, force measure
        nextTick(() => scroller.value?.refreshMeasurements?.());
        return;
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
        chat.value?.abort?.();
    } catch (e) {
        if (import.meta.dev) {
            console.warn('[ChatContainer] abort failed', e);
        }
    }
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('workflow:stop'));
        }
    } catch (e) {
        if (import.meta.dev) {
            console.warn('[ChatContainer] workflow stop dispatch failed', e);
        }
    }
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

const hooks = useHooks();
const cleanupWorkflowHook = hooks.on(
    'workflow.execution:action:state_update',
    (payload: { messageId: string; state: any }) => {
        // Only set if not already the same reference (avoid unnecessary reactivity triggers)
        const existing = workflowStates.get(payload.messageId);
        if (existing !== payload.state) {
            workflowStates.set(payload.messageId, payload.state);
        }
        // If same reference, Vue reactivity will pick up internal state changes via version
    }
);

onBeforeUnmount(() => {
    cleanupWorkflowHook();
    try {
        chat.value?.clear?.();
    } catch {}
});
</script>

<style>
/* Optional custom styles placeholder */
</style>
