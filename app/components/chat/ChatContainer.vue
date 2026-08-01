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
                :prefetch-overscan="5500"
                :content-key="props.tabId ?? props.threadId ?? 'new-thread'"
                mutation-mode="append-prepend"
                :maintain-bottom="!anyEditing"
                :bottom-threshold="5"
                :padding-bottom="bottomPad"
                :padding-top="28"
                class="chat-message-list"
                :style="scrollParentStyle"
                @scroll="onScroll"
                @prefetchRange="onPrefetchRange"
                @reachTop="emit('reached-top')"
                @reachBottom="emit('reached-bottom')"
            >
                <template #default="{ item, index }">
                    <div
                        :key="item.id || item.stream_id || index"
                        :class="CHAT_MESSAGE_ROW_CLASS"
                        :data-msg-id="item.id"
                        :data-stream-id="item.stream_id"
                    >
                        <component
                            :is="$theme.activeComponents.value['chat-message']"
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

        <!-- First-run welcome: true modal layer above mobile input (z-40) -->
        <Teleport to="body">
            <div
                v-if="showWelcomeCard"
                class="fixed inset-0 z-50 flex items-center justify-center bg-[color:color-mix(in_oklab,var(--md-scrim,#000)_45%,transparent)] p-4"
                data-welcome-backdrop
            >
                <ChatWelcomeCard @dismiss="onWelcomeDismiss" />
            </div>
        </Teleport>

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
                <component
                    :is="$theme.activeComponents.value['chat-input']"
                    :loading="inputLoading"
                    :streaming="streamingActive"
                    :container-width="containerWidth"
                    :thread-id="currentThreadId"
                    :pane-id="paneId"
                    :tab-id="tabId"
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
    isRef,
    type Ref,
    type CSSProperties,
    onBeforeUnmount,
    onMounted,
    nextTick,
} from 'vue';

import {
    getPanePendingPrompt,
    clearPanePendingPrompt,
    setPanePendingPrompt,
    setupPanePromptCleanup,
    usePanePendingPrompt,
} from '~/composables/core/usePanePrompt';
import type {
    ChatMessage as ChatMessageType,
    ChatRequestState,
    RegisterSendResult,
    SendResult,
} from '~/utils/chat/types';
import { Or3Scroll, type Or3ScrollViewState } from 'or3-scroll';
import 'or3-scroll/style.css';
import { useElementSize } from '@vueuse/core';
import { isMobile } from '~/state/global';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useToast, useHooks, useChat, useRuntimeConfig } from '#imports';
import { getMaxMessageFileHashes } from '~/db/files-util';
import { kv } from '~/db';
import {
    hydrateUserApiKeyFromKv,
    useUserApiKey,
} from '~/core/auth/useUserApiKey';
import { resolveOpenRouterKeyAvailability } from '~/core/auth/openRouterKeyAvailability';
import ChatWelcomeCard from '~/components/chat/ChatWelcomeCard.vue';
import { CHAT_MESSAGE_ROW_CLASS } from '~/components/chat/message-layout';
import { guardPendingAttachmentSend } from '~/composables/chat/pendingAttachmentGuard';
import { createMessageMediaPrefetchController } from '~/composables/chat/useMessageMediaPrefetch';
import type {
    ChatInstance,
    ImageAttachment,
    LargeTextAttachment,
    StreamState,
} from '../../../types/chat-internal';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import type { UiWorkflowState } from '~/utils/chat/workflow-types';
import type {
    WorkspaceTabScrollState,
    WorkspaceTabStatus,
} from '~/core/workspace-tabs/types';
// Removed onMounted/watchEffect (unused)

// Debug utilities removed per request.

const model = ref('openai/gpt-oss-120b');
const pendingPromptId = ref<string | null>(null);
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
// Use CSS breakpoints (not JS isMobile) so SSR HTML matches the first client
// render. ChatContainer is async-hydrated after useResponsiveState may already
// have flipped global isMobile, which previously caused hydration class mismatches.
// Breakpoint matches useResponsiveState: (max-width: 768px).
const inputWrapperClass =
    'pointer-events-none absolute inset-x-0 bottom-0 z-10 max-[768px]:fixed max-[768px]:z-40';
const inputWrapperStyle = computed<CSSProperties>(() => ({
    minHeight: `${DEFAULT_INPUT_HEIGHT}px`, // Reserve space to prevent CLS
    // Prevent child content from changing wrapper height during hydration
    contain: 'layout' as const,
}));
const innerInputContainerClass =
    'pointer-events-none flex justify-center sm:pr-[11px] px-1 pb-2 max-[768px]:pb-[calc(env(safe-area-inset-bottom)+6px)]';
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
    tabId?: string; // owns draft and scroll mementos, distinct from paneId
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
    (e: 'reached-top'): void;
    (e: 'reached-bottom'): void;
    (e: 'tab-status', status: WorkspaceTabStatus): void;
}>();

// ── First-run welcome card ──────────────────────────────────────────────
// Shown only when the chat is empty AND the user has no usable OpenRouter
// key. Disappears automatically once a key exists; dismissal is persisted.
const WELCOME_DISMISS_KV_KEY = 'or3_welcome_card_dismissed';
const runtimeConfig = useRuntimeConfig();
const { apiKey } = useUserApiKey();
const keyStateReady = ref(false);
const welcomeDismissed = ref(true); // default hidden until hydrated
const openRouterAvailability = computed(() =>
    resolveOpenRouterKeyAvailability(runtimeConfig.public?.openRouter)
);

const showWelcomeCard = computed(
    () =>
        keyStateReady.value &&
        !welcomeDismissed.value &&
        openRouterAvailability.value.canAcceptUserKey &&
        !openRouterAvailability.value.hasUsableKey(apiKey.value) &&
        allMessages.value.length === 0
);

function onWelcomeDismiss(): void {
    welcomeDismissed.value = true;
    kv.set(WELCOME_DISMISS_KV_KEY, 'true').catch(() => {
        // Persistence failure is non-critical; card just reappears next load.
    });
}

onMounted(async () => {
    try {
        await hydrateUserApiKeyFromKv();
    } catch {
        // Key hydration failure is non-critical.
    }
    try {
        const record = await kv.get(WELCOME_DISMISS_KV_KEY);
        welcomeDismissed.value = record?.value === 'true';
    } catch {
        welcomeDismissed.value = false;
    }
    keyStateReady.value = true;
});

// Register pane-close cleanup after Nuxt app context is available.
setupPanePromptCleanup();

// Initialize chat composable and make it refresh when threadId changes
// Initialized defensively (HMR can briefly leave it null in re-eval window)
// If pane has a pending prompt selection (chosen before thread exists) seed it
const promptOwnerId = computed(() => props.tabId ?? props.paneId);
if (promptOwnerId.value) {
    const pre = getPanePendingPrompt(promptOwnerId.value);
    if (pre) pendingPromptId.value = pre;
}
const panePendingPrompt = usePanePendingPrompt(promptOwnerId);
const chat = shallowRef<ChatInstance>(
    useChat(
        props.messageHistory,
        props.threadId,
        pendingPromptId.value || undefined,
        { historyAlreadyLoaded: true }
    ) as ChatInstance
);
// Ensure history + background job reattachment on initial load
void chat.value?.ensureHistorySynced?.();

watch(
    () => props.threadId,
    async (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) {
            return;
        }
        // Rebind in place — never call useChat() outside setup (inject warning).
        try {
            await chat.value?.switchThread?.(newId, {
                pendingPromptId: pendingPromptId.value || undefined,
            });
        } catch (e) {
            if (import.meta.dev) {
                console.warn(
                    '[ChatContainer] switchThread failed during thread switch',
                    e
                );
            }
        }
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
        const backgroundMode = backgroundJobMode.value;
        const backgroundJobIdValue = backgroundJobId.value;
        const hasPendingBackground = chat.value.messages.value.some(
            (m) => m.role === 'assistant' && m.pending
        );
        if (backgroundJobIdValue && hasPendingBackground) {
            return;
        }
        if (backgroundMode && backgroundMode !== 'none' && hasPendingBackground) {
            return;
        }
        if (hasPendingBackground) {
            return;
        }
        chat.value.replaceCanonicalHistory?.(mh || []);
    }
);

// When a new thread id is created internally (first send), propagate upward once
watch(
    () => chat.value?.threadId?.value,
    (id, prev) => {
        if (!prev && id) {
            emit('thread-selected', id);
            // Clear pending prompt (and pane-level cached) since it's applied
            if (promptOwnerId.value) clearPanePendingPrompt(promptOwnerId.value);
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
// Declare before every computed/watch that can run eagerly during setup.
// Vue evaluates immediate effects synchronously, so this must not sit below
// `workflowRunning` (which reads it during the first render).
const workflowStates = reactive(new Map<string, UiWorkflowState>());

const loading = computed(() => chat.value?.loading?.value || false);
const backgroundJobId = computed(() =>
    unwrapRef(chat.value?.backgroundJobId ?? null)
);
const backgroundJobMode = computed(() =>
    unwrapRef(chat.value?.backgroundJobMode ?? 'none')
);
const backgroundStreaming = computed(
    () => Boolean(backgroundJobId.value) && backgroundJobMode.value !== 'none'
);
const workflowRunning = computed(() => {
    for (const msg of messages.value) {
        if (!msg.id) continue;
        const wf = workflowStates.get(msg.id);
        if (wf?.executionState === 'running') return true;
    }
    return false;
});
const streamingActive = computed(
    () => loading.value || workflowRunning.value || backgroundStreaming.value
);
watch(
    [() => props.tabId, streamingActive],
    ([tabId, streaming]) => {
        if (tabId) emit('tab-status', streaming ? 'streaming' : 'idle');
    },
    { immediate: true }
);
const inputLoading = computed(
    () => loading.value || backgroundStreaming.value
);

// Tail streaming now provided directly by useChat composable
// `useChat` returns many refs; unwrap common ones so computed values expose plain objects/primitives
function unwrapRef<T>(refOrValue: T | Ref<T>): T {
    return isRef(refOrValue) ? refOrValue.value : refOrValue;
}

const streamId = computed(() => unwrapRef(chat.value?.streamId));
const streamState = computed<StreamState | null>(() => {
    const state = chat.value?.streamState as
        | Ref<StreamState | null>
        | StreamState
        | null
        | undefined;
    return unwrapRef<StreamState | null>(state ?? null);
});
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
function isUiWorkflowState(v: unknown): v is UiWorkflowState {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const r = v as Record<string, unknown>;
    if (typeof r.workflowId !== 'string') return false;
    if (typeof r.workflowName !== 'string') return false;
    if (typeof r.executionState !== 'string') return false;
    if (!Array.isArray(r.executionOrder)) return false;
    if (r.currentNodeId !== null && typeof r.currentNodeId !== 'string')
        return false;
    if (typeof r.nodeStates !== 'object' || r.nodeStates === null) return false;
    return true;
}

// Seed workflow state map from loaded messages so reloads show correct status
watch(
    () => messages.value,
    (list) => {
        if (!Array.isArray(list)) return;
        const visibleIds = new Set<string>();
        for (const msg of list) {
            if (msg.id) visibleIds.add(msg.id);
            const wf = msg.workflowState;
            if (!isUiWorkflowState(wf)) continue;
            const existing = workflowStates.get(msg.id);
            const existingVersion = existing?.version ?? -1;
            const nextVersion = wf.version ?? 0;
            if (!existing || nextVersion > existingVersion) {
                workflowStates.set(msg.id, wf);
            }
        }
        for (const id of Array.from(workflowStates.keys())) {
            if (!visibleIds.has(id)) {
                workflowStates.delete(id);
            }
        }
    },
    { immediate: true }
);

watch(
    () => props.threadId,
    () => {
        workflowStates.clear();
    }
);

function deriveWorkflowText(wf: UiWorkflowState): string {
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
    };
}

// Stable history and workflow projection only recompute when history or workflow
// state changes. Streaming token updates patch the single tail slot in place.
const stableMessagesWithWorkflow = computed(() =>
    stableMessages.value.map(mergeWorkflowState)
);
const stableMessageIdentities = computed(() => {
    const identities = new Set<string>();
    for (const message of stableMessages.value) {
        if (message.id) identities.add(`id:${message.id}`);
        if (message.stream_id) identities.add(`stream:${message.stream_id}`);
    }
    return identities;
});
const allMessages = shallowRef<UiChatMessage[]>([]);
let renderedStableSnapshot: UiChatMessage[] | null = null;

watch(
    [stableMessagesWithWorkflow, stableMessageIdentities, streamingMessage],
    ([stable, identities, tail]) => {
        const tailAlreadyStable =
            Boolean(tail?.id && identities.has(`id:${tail.id}`)) ||
            Boolean(
                tail?.stream_id &&
                    identities.has(`stream:${tail.stream_id}`)
            );

        if (!tail || tailAlreadyStable) {
            allMessages.value = stable;
            renderedStableSnapshot = stable;
            return;
        }

        const mergedTail = mergeWorkflowState(tail);
        if (
            renderedStableSnapshot === stable &&
            allMessages.value.length === stable.length + 1
        ) {
            // Or3Scroll memoizes rows from the items array identity. Replacing
            // only the tail slot (even with triggerRef) leaves its rendered row
            // stale while tokens are streaming.
            allMessages.value = [...stable, mergedTail];
            return;
        }

        allMessages.value = [...stable, mergedTail];
        renderedStableSnapshot = stable;
    },
    { immediate: true }
);

// Media prefetch is intentionally separate from row mounting. Keep the proven
// 5500px render overscan until the browser canary passes at 1200/5500.
const mediaPrefetch = createMessageMediaPrefetchController({ concurrency: 4 });

function onPrefetchRange(range: { startIndex: number; endIndex: number }) {
    mediaPrefetch.updateRange(allMessages.value, range);
}

watch(
    () => props.threadId,
    () => mediaPrefetch.reset()
);

onBeforeUnmount(() => mediaPrefetch.dispose());

// Scroll handling centralized in VirtualMessageList
// Ref is now the VirtualMessageList component instance, not a raw element
type ScrollApi = {
    scrollToBottom?: (opts?: { smooth?: boolean }) => void;
    captureScrollState?: () => Or3ScrollViewState;
    restoreScrollState?: (state?: Or3ScrollViewState) => Promise<void>;
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
const lastScrollTop = ref(0);
const iconScrollToBottom = useIcon('chat.scrollToBottom');

const scrollToBottomOverrides = useThemeOverrides({
    component: 'button',
    context: 'chat',
    identifier: 'chat.scroll-to-bottom',
    isNuxtUI: true,
});

const scrollToBottomButtonProps = computed(() => ({
    icon: iconScrollToBottom.value || 'heroicons:arrow-down-20-solid',
    size: 'sm' as const,
    color: 'primary' as const,
    variant: 'solid' as const,
    ui: { base: 'rounded-full' },
    class: 'shadow-lg',
    ...scrollToBottomOverrides.value,
}));

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
    lastScrollTop.value = payload.scrollTop;
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

function captureViewState() {
    const scrollState = scroller.value?.captureScrollState?.();
    return {
        scroll: {
            version: 1 as const,
            contentKey:
                scrollState?.contentKey !== undefined
                    ? String(scrollState.contentKey)
                    : props.tabId ?? props.threadId,
            mode:
                scrollState?.mode ??
                (atBottom.value ? ('bottom' as const) : ('anchor' as const)),
            anchors: scrollState?.anchors?.map((anchor) => ({
                key: String(anchor.key),
                withinItem: anchor.withinItem,
                fallbackIndex: anchor.index,
            })),
            scrollTop: scrollState?.scrollTop ?? lastScrollTop.value,
        } satisfies WorkspaceTabScrollState,
    };
}

async function restoreViewState(saved?: ReturnType<typeof captureViewState>) {
    if (!saved?.scroll) return;
    await nextTick();
    if (saved.scroll.mode === 'bottom') {
        scroller.value?.scrollToBottom?.({ smooth: false });
        return;
    }
    if (scroller.value?.restoreScrollState) {
        await scroller.value.restoreScrollState({
            version: 1,
            contentKey: saved.scroll.contentKey,
            mode: saved.scroll.mode,
            anchors: saved.scroll.anchors?.map((anchor) => ({
                key: anchor.key,
                withinItem: anchor.withinItem,
                index: anchor.fallbackIndex,
            })),
            scrollTop: saved.scroll.scrollTop,
        });
        return;
    }
    // Compatibility fallback for a host that still provides an older scroll API.
    const root = (scroller.value as { $el?: HTMLElement } | null)?.$el;
    if (root) root.scrollTop = Math.max(0, saved.scroll.scrollTop);
}

// (8.4) Auto-scroll already consolidated; tail growth handled via version watcher
// Chat send abstraction (Req 3.5)
const toast = useToast();

function collectRecentHashes(limit = getMaxMessageFileHashes()): string[] {
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
    thinkingEnabled: boolean;
    reasoningEffort?: string | null;
    registerResult: RegisterSendResult;
};

function waitForDurableSendAcceptance(
    activeChat: ChatInstance,
    terminal: Promise<SendResult>
): Promise<SendResult> {
    const stateRef = activeChat.requestState;
    if (!isRef(stateRef)) return terminal;

    const initial = stateRef.value as ChatRequestState;
    if (initial.status === 'idle' || initial.status === 'terminal') {
        return terminal;
    }
    const requestId = initial.requestId;

    return new Promise<SendResult>((resolve, reject) => {
        let settled = false;
        let stopWatcher: (() => void) | null = null;
        const finish = (result: SendResult) => {
            if (settled) return;
            settled = true;
            stopWatcher?.();
            resolve(result);
        };
        const inspect = (state: ChatRequestState) => {
            if (state.status === 'idle' || state.requestId !== requestId) return;
            if (state.status === 'persisted') {
                finish({
                    status: 'accepted',
                    requestId,
                    userMessageId: state.userMessageId,
                });
            } else if (state.status === 'streaming') {
                finish({
                    status: 'accepted',
                    requestId,
                    userMessageId: state.userMessageId,
                    assistantMessageId: state.assistantMessageId,
                });
            } else if (state.status === 'terminal') {
                finish(state.result);
            }
        };

        stopWatcher = watch(stateRef, inspect, { immediate: true });
        if (settled) stopWatcher();
        void terminal.then(finish, (error) => {
            if (settled) return;
            settled = true;
            stopWatcher?.();
            reject(error);
        });
    });
}

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

    if (
        pendingCount > 0 &&
        !guardPendingAttachmentSend(attachments, toast, {
            description: 'Please wait for attachments to finish.',
            duration: 2400,
        })
    ) {
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
    const activeChat = chat.value;
    if (!activeChat) return;
    const result = activeChat.send({
        content: payload.text,
        model: payload.model || model.value,
        files,
        file_hashes,
        extraTextParts,
        online: !!payload.webSearchEnabled,
        thinking: !!payload.thinkingEnabled,
        reasoningEffort: payload.reasoningEffort ?? null,
        context_hashes,
    });
    payload.registerResult(
        result,
        waitForDurableSendAcceptance(activeChat, result)
    );
    void result
        .then(() => {
            // Ensure layout is stable after sending (input shrink + new message)
            nextTick(() => scroller.value?.refreshMeasurements?.());
        })
        .catch(() => {});
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
    if (pendingPromptId.value === promptId) return;
    pendingPromptId.value = promptId;
    // Store tab-level until thread creation. Legacy panes use the pane ID.
    if (promptOwnerId.value) {
        setPanePendingPrompt(promptOwnerId.value, promptId);
    }
    // Update in place — never call useChat() outside setup (inject warning).
    chat.value?.setPendingPrompt?.(promptId);
}

watch(panePendingPrompt, (promptId) => {
    onPendingPromptSelected(promptId ?? null);
});

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
    (payload: { messageId: string; state: unknown }) => {
        if (!isUiWorkflowState(payload.state)) return;
        const activeIds = new Set(
            messages.value
                .map((m) => m.id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
        );
        if (!activeIds.has(payload.messageId)) return;
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
        chat.value?.dispose?.();
    } catch {}
});

defineExpose({ captureViewState, restoreViewState });
</script>

<style>
/* Optional custom styles placeholder */
</style>
