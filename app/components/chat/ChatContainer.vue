<template>
    <main
        ref="containerRoot"
        v-bind="containerProps"
        :class="[
            'chat-container-root flex w-full flex-1 h-full min-h-0 flex-col overflow-hidden relative [container:chat-pane/size]',
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
                :row-content-revision="rowContentRevision"
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
                            :is="resolveCoreChatComponent($theme.activeComponents.value['chat-message'], 'chat-message')"
                            :message="item"
                            :thread-id="props.threadId"
                            :retry-disabled="retryPending || loading"
                            :compaction-action="compactionActionFor(item)"
                            :history-retrieval-available="historyRetrievalAvailable"
                            @retry="onRetry"
                            @continue="onContinue"
                            @branch="onBranch"
                            @view-compaction-source="onViewCompactionSource(item, $event)"
                            @view-related-thread="onViewRelatedThread(item, $event)"
                            @edited="onEdited"
                            @begin-edit="onBeginEdit(item.id)"
                            @cancel-edit="onEndEdit(item.id)"
                            @save-edit="onEndEdit(item.id)"
                        />
                    </div>
                </template>
            </Or3Scroll>
            <template #fallback>
                <div
                    class="chat-message-list flex-1 min-h-0 px-4 pt-8"
                    :style="scrollParentStyle"
                    aria-hidden="true"
                >
                    <div v-if="threadId" class="mx-auto max-w-[780px] space-y-6 animate-pulse">
                        <div class="ml-auto h-12 w-2/3 bg-[var(--md-surface-variant)]" />
                        <div class="h-24 w-5/6 bg-[var(--md-surface-variant)]" />
                    </div>
                </div>
            </template>
        </ClientOnly>

        <!-- First-run welcome: true modal layer above mobile input (z-40) -->
        <Teleport to="body">
            <div
                v-if="showWelcomeCard"
                class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[color:color-mix(in_oklab,var(--md-scrim,#000)_45%,transparent)] p-4"
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
                <div
                    v-if="retryPending && !loading"
                    role="status"
                    aria-live="polite"
                    class="absolute bottom-full left-0 right-0 mb-12 flex justify-center pointer-events-none"
                >
                    <span class="rounded-full bg-(--md-surface) px-3 py-1 text-sm shadow-sm">
                        Preparing retry…
                    </span>
                </div>
                <component
                    :is="resolveCoreChatComponent($theme.activeComponents.value['chat-input'], 'chat-input')"
                    :loading="inputLoading || compaction.active.value"
                    :streaming="streamingActive"
                    :container-width="containerWidth"
                    :thread-id="currentThreadId"
                    :pane-id="paneId"
                    :tab-id="tabId"
                    :context-revision="allMessages"
                    :compact-thread="compactThread"
                    :compaction-blocked-reason="threadCompactionBlockedReason"
                    :compaction-state="compaction.state.value"
                    @cancel-compaction="compaction.cancel()"
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
    type Component,
    onBeforeUnmount,
    onMounted,
    nextTick,
    inject,
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
import { Or3Scroll } from 'or3-scroll';
import ChatInputDropper from '~/components/chat/ChatInputDropper.vue';
import { CORE_APP_COMPONENT_DEFAULTS } from '~/theme/_shared/theme-components-registry';
import 'or3-scroll/style.css';
import { useElementSize } from '@vueuse/core';
import { isMobile } from '~/state/global';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useToast, useHooks, useChat, useRuntimeConfig, useRoute, useState } from '#imports';
import { getMaxMessageFileHashes } from '~/db/files-util';
import { kv } from '~/db';
import { getDb, getActiveWorkspaceId, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { liveQuery, type Subscription } from 'dexie';
import { useThreadCompaction } from '~/composables/chat/useThreadCompaction';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { stripModelVariantSuffix } from '~~/shared/openrouter/model-variants';
import { resolveSystemPromptText } from '~/utils/chat/useAi-internal/messageBuild';
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

function resolveCoreChatComponent(
    active: Component | undefined,
    key: 'chat-input' | 'chat-message'
): Component {
    if (active && active !== CORE_APP_COMPONENT_DEFAULTS[key]) return active;
    // Reuse the registry's lazy message renderer: empty chats do not need
    // Markdown/highlighting in the root preload graph.
    return key === 'chat-input'
        ? ChatInputDropper
        : CORE_APP_COMPONENT_DEFAULTS['chat-message'];
}

const model = ref('~openai/gpt-luna-latest');
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
// Breakpoint matches useResponsiveState and Tailwind's md boundary.
const inputWrapperClass =
    'pointer-events-none absolute inset-x-0 bottom-0 z-10 max-md:z-40';
const inputWrapperStyle = computed<CSSProperties>(() => ({
    minHeight: `${DEFAULT_INPUT_HEIGHT}px`, // Reserve space to prevent CLS
    // Prevent child content from changing wrapper height during hydration
    contain: 'layout' as const,
}));
const innerInputContainerClass =
    'pointer-events-none flex justify-center sm:pr-[11px] px-1 pb-2 max-md:pb-[calc(env(safe-area-inset-bottom)+6px)]';
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
    (e: 'view-compaction-source', target: { threadId: string; messageId: string; originThreadId: string; scrollMessageId?: string; generation: number }): void;
    (e: 'view-related-thread', target: { threadId: string; originThreadId: string; anchorMessageId: string; generation: number }): void;
    (e: 'reached-top'): void;
    (e: 'reached-bottom'): void;
    (e: 'tab-status', status: WorkspaceTabStatus): void;
}>();

// ── First-run welcome card ──────────────────────────────────────────────
// Shown only when the chat is empty AND the user has no usable OpenRouter
// key. Disappears automatically once a key exists; dismissal is persisted.
const WELCOME_DISMISS_KV_KEY = 'or3_welcome_card_dismissed';
const runtimeConfig = useRuntimeConfig();
const route = useRoute();
const welcomePreviewRequested = computed(() => route.query.welcome === '1');
const welcomePreviewDismissed = ref(false);
// Managed Cloud must let an anonymous visitor reach the sign-in control before
// showing the OpenRouter first-run card. The shared auth-session state is
// populated by useSessionContext after sign-in; local/static builds have no
// auth gate and may show the card immediately.
const authSessionState = useState<{ session?: { authenticated?: boolean } } | null>(
    'auth-session',
    () => null,
);
const { apiKey } = useUserApiKey();
const keyStateReady = ref(false);
const welcomeDismissed = ref(true); // default hidden until hydrated
const dashboardModalOpen = inject<Ref<boolean>>('or3:dashboard-modal-open', ref(false));
const openRouterAvailability = computed(() =>
    resolveOpenRouterKeyAvailability(runtimeConfig.public?.openRouter)
);

const showWelcomeCard = computed(
    () =>
        runtimeConfig.public.pluginDevelopment !== true &&
        keyStateReady.value &&
        (runtimeConfig.public?.ssrAuthEnabled !== true ||
            authSessionState.value?.session?.authenticated === true) &&
        !dashboardModalOpen.value &&
        (welcomePreviewRequested.value
            ? !welcomePreviewDismissed.value
            : !welcomeDismissed.value &&
              openRouterAvailability.value.canAcceptUserKey &&
              !openRouterAvailability.value.hasUsableKey(apiKey.value) &&
              allMessages.value.length === 0)
);

function onWelcomeDismiss(): void {
    if (welcomePreviewRequested.value) {
        welcomePreviewDismissed.value = true;
        return;
    }
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
const retryPending = ref(false);
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
    () => retryPending.value || loading.value || backgroundStreaming.value
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
    // The installed workflow renderer uses finalOutput for its result box.
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
const compactionPreferences = useAiSettings();
const compactionModels = useModelStore();
const historyRegistry = useToolRegistry();
const historyRetrievalAvailable = computed(() => {
    const id = stripModelVariantSuffix(model.value.replace(/:thinking$/, ''));
    const metadata = compactionModels.catalog.value.find((row) => row.id === id || row.canonical_slug === id)
        ?? compactionModels.favoriteModels.value.find((row) => row.id === id || row.canonical_slug === id);
    return metadata?.supported_parameters?.includes('tools') === true && historyRegistry.getEnabledDefinitions({
        workspaceId: getActiveWorkspaceId() ?? 'local', threadId: currentThreadId.value ?? null,
    }).some((tool) => tool.function.name === 'get_message');
});
const compaction = useThreadCompaction({ threadId: currentThreadId, model,
    isBusy: () => inputLoading.value || workflowRunning.value,
    apiKey: () => apiKey.value, isCurrent: () => props.threadId === currentThreadId.value,
    getPreferences: async () => { await compactionPreferences.ensureLoaded(); return { ...compactionPreferences.settings.value }; },
    resolveModelMetadata: async (selected) => {
        const result = await compactionModels.resolveContextModel(selected);
        return result.ok ? result.metadata : undefined;
    },
    getTaskSystemPrompt: (threadId) => resolveSystemPromptText({ threadId, activePromptContent: null }),
    onCommitted: (result) => { emit('thread-selected', result.thread.id); },
});
async function compactThread(anchorMessageId?: string) {
    const result = await compaction.start(anchorMessageId);
    if (!result.ok) toast.add({ title: 'Unable to compact', description: result.message, color: 'warning' });
}
const localCompactionIds = shallowRef<Set<string>>();
let compactionOwnerSubscription: Subscription | undefined;
let compactionOwnerRevision = 0;
function bindCompactionOwners() {
    compactionOwnerSubscription?.unsubscribe(); localCompactionIds.value = undefined;
    const token = ++compactionOwnerRevision; const db = getDb(); const generation = getWorkspaceGeneration(); const source = currentThreadId.value;
    if (!source) return;
    compactionOwnerSubscription = liveQuery(() => db.messages.where('thread_id').equals(source).primaryKeys()).subscribe({
        next: (ids) => { if (token === compactionOwnerRevision && db === getDb() && generation === getWorkspaceGeneration()) localCompactionIds.value = new Set(ids); },
        error: () => { if (token === compactionOwnerRevision) localCompactionIds.value = undefined; },
    });
}
watch(currentThreadId, bindCompactionOwners, { immediate: true });
const stopCompactionOwners = subscribeActiveWorkspaceDb(bindCompactionOwners);
onBeforeUnmount(() => { compactionOwnerRevision++; compactionOwnerSubscription?.unsubscribe(); stopCompactionOwners(); });
const anchorCompactionReasons = computed(() => {
    const reasons = new Map<string, string | undefined>(); let turns = 0; let pendingUser = false;
    const busy = allMessages.value.some((row) => row.pending || row.toolCalls?.some((call) => !['complete', 'error'].includes(call.status)));
    for (const row of allMessages.value) {
        if (row.role === 'user') pendingUser = true;
        if (row.role === 'assistant' && row.text.trim() && pendingUser) { turns++; pendingUser = false; }
        reasons.set(row.id, compaction.blockedReason.value || (busy ? 'Wait for pending generation and tools to settle.'
            : !localCompactionIds.value ? 'Checking the persisted source.' : !localCompactionIds.value.has(row.id)
                ? 'Open the original conversation to compact this inherited message.'
                : turns < 2 ? 'Compaction requires at least two settled user/assistant turns.' : undefined));
    }
    return reasons;
});
function compactionActionFor(message: UiChatMessage) {
    return { start: compactThread, blockedReason: anchorCompactionReasons.value.get(message.id) ?? compaction.blockedReason.value };
}
const threadCompactionBlockedReason = computed(() => {
    const anchor = [...allMessages.value].reverse().find((row) => localCompactionIds.value?.has(row.id));
    return compaction.blockedReason.value ?? (anchor ? anchorCompactionReasons.value.get(anchor.id) : 'Choose a persisted conversation with settled turns.');
});
const rowContentRevision = ref(0);
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
        const tailKey = mergedTail.id || mergedTail.stream_id || '';
        const currentTail =
            allMessages.value.length === stable.length + 1
                ? allMessages.value[stable.length]
                : null;
        const currentTailKey = currentTail
            ? currentTail.id || currentTail.stream_id || ''
            : null;
        if (
            renderedStableSnapshot === stable &&
            allMessages.value.length === stable.length + 1 &&
            currentTailKey !== null &&
            currentTailKey === tailKey
        ) {
            // Same stable snapshot, length, and tail key: patch the tail slot in
            // place and bump the revision so Or3Scroll re-reads mounted rows
            // without replacing the combined array or scanning history.
            allMessages.value[stable.length] = mergedTail;
            rowContentRevision.value++;
            return;
        }

        // Everything else (initial load, insertion/removal, changed tail key,
        // stable/workflow replacement, deduplication) replaces the array.
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
type ScrollViewState = {
    version: 1;
    contentKey?: string | number;
    mode: 'bottom' | 'anchor';
    anchors?: Array<{
        key: string | number;
        withinItem: number;
        index: number;
    }>;
    scrollTop: number;
};

type ScrollApi = {
    scrollToBottom?: (opts?: { smooth?: boolean }) => void;
    scrollToItemKey?: (key: string, opts?: { align?: 'start' | 'center' | 'end'; smooth?: boolean }) => void;
    captureScrollState?: () => ScrollViewState;
    restoreScrollState?: (state?: ScrollViewState) => Promise<void>;
    refreshMeasurements?: () => void;
};
const scroller = ref<ScrollApi | null>(null);
const compactionNavigation = shallowRef<{ threadId: string; messageId: string; generation: number; origin: string | undefined }>();
function onViewRelatedThread(message: UiChatMessage, target: { threadId: string; originThreadId: string; anchorMessageId: string; generation: number }) {
    if (currentThreadId.value !== target.originThreadId || props.threadId !== target.originThreadId
        || getWorkspaceGeneration() !== target.generation || message.id !== target.anchorMessageId
        || !allMessages.value.some((row) => row.id === message.id)) return;
    emit('view-related-thread', target);
}
function onViewCompactionSource(message: UiChatMessage, target: { threadId: string; messageId: string; originThreadId: string; scrollMessageId?: string }) {
    const data = message.compaction;
    if (currentThreadId.value !== target.originThreadId || props.threadId !== target.originThreadId) return;
    if (!data || !allMessages.value.some((row) => row.id === message.id)) return;
    const allowed = data.source_thread_id === target.threadId && data.anchor_message_id === target.messageId
        || data.landmarks.some((landmark) => landmark.thread_id === target.threadId && landmark.message_id === target.messageId);
    if (!allowed) return;
    emit('view-compaction-source', { ...target, generation: getWorkspaceGeneration() });
}
// PageShell calls the destination pane after its normal resource activation.
// The source identity remains in the event; this command uses the visible row.
function scrollToMessage(target: { threadId: string; messageId: string; generation: number }) {
    if (getWorkspaceGeneration() !== target.generation || props.threadId !== target.threadId) return;
    compactionNavigation.value = { ...target, origin: currentThreadId.value };
}
watch([currentThreadId, allMessages, loading, compactionNavigation], async () => {
    const target = compactionNavigation.value;
    if (!target) return;
    if (getWorkspaceGeneration() !== target.generation || currentThreadId.value !== target.threadId && currentThreadId.value !== target.origin) {
        compactionNavigation.value = undefined; return;
    }
    if (loading.value || currentThreadId.value !== target.threadId || !allMessages.value.some((row) => row.id === target.messageId)) return;
    await nextTick();
    if (compactionNavigation.value !== target || getWorkspaceGeneration() !== target.generation || currentThreadId.value !== target.threadId) return;
    scroller.value?.scrollToItemKey?.(target.messageId, { align: 'center', smooth: false });
    compactionNavigation.value = undefined;
});

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
    editorDoc?: Record<string, unknown>;
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
    modelVariant: import('~~/shared/openrouter/model-variants').OpenRouterModelVariant;
    thinkingEnabled: boolean;
    reasoningEffort?: string | null;
    registerResult: RegisterSendResult;
    inspectLossyRequest?: boolean;
    lossyConfirmation?: import('~/utils/chat/lossy-request').LossyRequestPreview;
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
            if (state.status === 'streaming' && state.providerAccepted) {
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
    if (loading.value || retryPending.value || compaction.active.value) return;
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
        editorDoc: payload.editorDoc,
        content: payload.text,
        model: payload.model || model.value,
        files,
        file_hashes,
        extraTextParts,
        modelVariant: payload.modelVariant ?? 'off',
        thinking: !!payload.thinkingEnabled,
        reasoningEffort: payload.reasoningEffort ?? null,
        context_hashes,
        inspectLossyRequest: payload.inspectLossyRequest,
        lossyConfirmation: payload.lossyConfirmation,
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

async function onRetry(messageId: string) {
    const activeChat = chat.value;
    if (!activeChat || activeChat.loading.value || retryPending.value || compaction.active.value) return;
    retryPending.value = true;
    try {
        // A retry is appended after the remaining conversation. Move the
        // viewport there immediately instead of leaving it at the old turn.
        await nextTick();
        scroller.value?.scrollToBottom?.({ smooth: false });
        const result = await activeChat.retryMessage(messageId, model.value);
        if (!result || result.status === 'rejected') {
            toast.add({
                title: 'Retry did not start',
                description: 'Your conversation is unchanged. Please try again.',
                color: 'warning',
                duration: 3500,
            });
        }
    } catch (error) {
        toast.add({
            title: 'Retry failed',
            description: error instanceof Error ? error.message : 'Please try again.',
            color: 'error',
            duration: 3500,
        });
    } finally {
        retryPending.value = false;
        await nextTick();
        scroller.value?.refreshMeasurements?.();
    }
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
        // A foreground chat stream owns the composer stop control even when an
        // older workflow is still running in this thread.
        if (typeof window !== 'undefined' && !loading.value) {
            const workflowMessage = [...messages.value]
                .reverse()
                .find((message) => {
                    if (!message.id) return false;
                    const executionState = workflowStates.get(message.id)
                        ?.executionState;
                    return executionState === 'running';
                });
            if (workflowMessage?.id) {
                window.dispatchEvent(
                    new CustomEvent('workflow:stop', {
                        detail: { messageId: workflowMessage.id },
                    })
                );
                return;
            }
        }
    } catch (e) {
        if (import.meta.dev) {
            console.warn('[ChatContainer] workflow stop dispatch failed', e);
        }
    }
    try {
        chat.value?.abort?.();
    } catch (e) {
        if (import.meta.dev) {
            console.warn('[ChatContainer] abort failed', e);
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
        const incomingVersion = payload.state.version ?? 0;
        const existingVersion = existing?.version ?? -1;
        if (existing !== payload.state && incomingVersion >= existingVersion) {
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

defineExpose({ captureViewState, restoreViewState, scrollToMessage, compactThread });
</script>

<style>
/* Optional custom styles placeholder */
</style>
