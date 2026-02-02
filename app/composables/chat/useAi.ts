/**
 * @module app/composables/chat/useAi.ts
 *
 * Purpose:
 * Primary chat composable that coordinates local-first persistence, model
 * message preparation, streaming, and hook orchestration for the chat UI.
 *
 * Responsibilities:
 * - Manage chat state for a thread (messages, loading, aborts)
 * - Build model input and system prompts for send requests
 * - Orchestrate streaming lifecycle and background job integration
 * - Emit hooks for plugins and extensions
 *
 * Non-Goals:
 * - Direct provider implementation details
 * - Server-only auth or SSR middleware behavior
 * - Long-lived background job processing
 *
 * Invariants:
 * - Local IndexedDB is the source of truth for UI state
 * - Hook timing order remains stable for plugins
 * - Abort always finalizes stream accumulator state
 */

import { ref, computed, watch, onScopeDispose } from 'vue';
import { useToast, useAppConfig, useRuntimeConfig } from '#imports';
import { nowSec, newId } from '~/db/util';
import { create, tx, upsert, type Message } from '~/db';
import { getDb } from '~/db/client';
import { serializeFileHashes } from '~/db/files-util';
import { normalizeFileUrl } from '~/utils/chat/useAi-internal/files';
import {
    parseHashes,
    mergeAssistantFileHashes,
} from '~/utils/files/attachments';
import { messagesByThread } from '~/db/messages';
import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
} from '~/utils/chat/types';
import { ensureUiMessage, recordRawMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import {
    buildParts,
    deriveMessageContent,
} from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import {
    startBackgroundStream,
    abortBackgroundJob,
    isBackgroundStreamingEnabled,
    type BackgroundJobStatus,
} from '../../utils/chat/openrouterStream';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { inferMimeFromUrl } from '~/utils/chat/files';
import { createStreamAccumulator } from '~/composables/chat/useStreamAccumulator';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { resolveDefaultModel } from '~/core/auth/models-service';
import { state } from '~/state/global';
// Import paths aligned with tests' vi.mock targets
import { useUserApiKey } from '#imports';
import { useActivePrompt } from '#imports';
import { getDefaultPromptId } from '#imports';
import { useHooks } from '#imports';
import { consumeWorkflowHandlingFlag } from '~/plugins/workflow-slash-commands.client';
import { NotificationService } from '~/core/notifications/notification-service';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { retryMessageImpl, continueMessageImpl } from '~/utils/chat/useAi-internal';
// settings/model store are provided elsewhere at runtime; keep dynamic access guards
import type {
    ChatSettings,
    ModelInfo,
    PaneContext,
    ExtendedSendMessageParams,
} from '../../../types/chat-internal';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { ORMessage } from '~/core/auth/openrouter-build';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import {
    BACKGROUND_JOB_POLL_INTERVAL_MS,
    BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS,
    BACKGROUND_JOB_PERSIST_INTERVAL_MS,
    BACKGROUND_JOB_MUTED_KEY,
    type BackgroundJobUpdate,
    type BackgroundJobSubscriber,
    type BackgroundJobTracker,
    backgroundJobTrackers,
    primeBackgroundJobUpdate,
    stopBackgroundJobTracking,
    ensureBackgroundJobTracker,
    subscribeBackgroundJob,
    runForegroundStreamLoop,
    resolveSystemPromptText,
    buildSystemPromptMessage,
    buildOpenRouterMessagesForSend
} from '~/utils/chat/useAi-internal';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

type GlobalWithPaneApi = typeof globalThis & {
    __or3MultiPaneApi?: UseMultiPaneApi;
};

type StoredMessage = Message & {
    data?: {
        content?: string;
        reasoning_text?: string | null;
        tool_calls?: ToolCallInfo[] | null;
        background_job_id?: string;
        background_job_status?: BackgroundJobStatus['status'];
        background_job_error?: string | null;
        [key: string]: unknown;
    } | null;
    content?: string | ContentPart[];
    file_hashes?: string | null;
    reasoning_text?: string | null;
    stream_id?: string | null;
};

type OpenRouterMessage =
    | ORMessage
    | {
          role: 'tool';
          [key: string]: unknown;
      };

// Per-instance streaming tail state

/**
 * Purpose:
 * Provides reactive chat state and operations for a single thread.
 * Handles message creation, streaming, background jobs, and lifecycle cleanup.
 *
 * Behavior:
 * - Appends user messages to IndexedDB and UI state
 * - Streams assistant responses with tool execution support
 * - Supports background streaming when enabled and safe
 * - Emits hook actions and filters during key phases
 * - Aborts in-flight streams on request and preserves partial output
 *
 * Constraints:
 * - Must be used within a Vue setup scope
 * - Thread id must be set before sending messages
 * - Background streaming only enabled for text-only requests
 *
 * Non-Goals:
 * - Does not manage navigation or routing
 * - Does not expose provider secrets in client state
 */
export function useChat(
    msgs: ChatMessage[] = [],
    initialThreadId?: string,
    pendingPromptId?: string
) {
    // Messages and basic state
    const messages = ref<UiChatMessage[]>(msgs.map((m) => ensureUiMessage(m)));
    const rawMessages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const abortController = ref<AbortController | null>(null);
    const aborted = ref<boolean>(false);
    const { apiKey, setKey } = useUserApiKey();
    const runtimeConfig = useRuntimeConfig();
    const sessionContext =
        runtimeConfig.public.ssrAuthEnabled === true ? useSessionContext() : null;
    const notificationUserId = computed(() =>
        resolveNotificationUserId(sessionContext?.data.value?.session)
    );
    const openRouterConfig = computed(() => runtimeConfig.public.openRouter);
    const requireUserKey = computed(
        () => openRouterConfig.value.requireUserKey === true
    );
    const allowUserOverride = computed(
        () =>
            openRouterConfig.value.allowUserOverride !== false ||
            requireUserKey.value
    );
    const hasInstanceKey = computed(
        () =>
            openRouterConfig.value.hasInstanceKey === true &&
            !requireUserKey.value
    );
    const effectiveApiKey = computed(() =>
        allowUserOverride.value ? apiKey.value : null
    );
    const guestAccessEnabled = computed(
        () => runtimeConfig.public.guestAccessEnabled === true
    );
    const limitsConfig = computed(() => runtimeConfig.public.limits);
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    const historyLoadedFor = ref<string | null>(null);
    const cleanupFns: Array<() => void> = [];

    watch(
        () => notificationUserId.value,
        (nextUserId) => {
            if (!nextUserId) return;
            for (const tracker of backgroundJobTrackers.values()) {
                tracker.userId = nextUserId;
            }
        },
        { immediate: true }
    );

    if (import.meta.dev) {
        if (state.value.openrouterKey && apiKey.value) {
            setKey(state.value.openrouterKey);
        }
    }

    const streamAcc = createStreamAccumulator();
    const streamState = streamAcc.state;
    const streamId = ref<string | undefined>(undefined);
    const backgroundJobId = ref<string | null>(null);
    const backgroundJobMode = ref<'none' | 'background'>('none');
    const backgroundJobInfo = ref<{
        jobId: string;
        threadId: string;
        messageId: string;
    } | null>(null);
    const backgroundJobDisposers: Array<() => void> = [];
    const attachedBackgroundJobs = new Set<string>();
    const detached = ref<boolean>(false);
    const isDetached = () => detached.value;
    /**
     * Purpose:
     * Resets per-request stream state and clears the active stream id.
     *
     * Behavior:
     * - Clears stream accumulator buffers
     * - Clears the public `streamId` ref
     *
     * Constraints:
     * - Safe to call multiple times
     */
    function resetStream() {
        streamAcc.reset();
        streamId.value = undefined;
    }

    const backgroundStreamingConfig = computed(() =>
        (runtimeConfig.public as { backgroundStreaming?: { enabled?: boolean } })
            .backgroundStreaming
    );
    const backgroundStreamingAllowed = computed(
        () => {
            if (runtimeConfig.public.ssrAuthEnabled !== true) return false;
            if (backgroundStreamingConfig.value?.enabled !== true) return false;
            if (!isBackgroundStreamingEnabled()) return false;
            const session = sessionContext?.data.value?.session;
            return Boolean(session?.authenticated && session?.workspace?.id);
        }
    );

    /**
     * Purpose:
     * Enforces local client-side limits for conversations and daily messages.
     *
     * Behavior:
     * - Checks max conversation count for new threads
     * - Checks daily message quota
     * - Emits toast warnings when limits are exceeded
     *
     * Constraints:
     * - This is a client-side guard only, not an authorization layer
     */
    async function enforceClientLimits(isNewThread: boolean): Promise<boolean> {
        const limits = limitsConfig.value;
        if (limits.enabled === false) return true;

        const toast = useToast();

        const maxConversations =
            typeof limits.maxConversations === 'number'
                ? limits.maxConversations
                : 0;
        if (isNewThread && maxConversations > 0) {
            const threadCount = await getDb().threads
                .filter((thread) => thread.deleted !== true)
                .count();
            if (threadCount >= maxConversations) {
                toast.add({
                    title: 'Conversation limit reached',
                    description:
                        'You have reached the maximum number of conversations allowed for this instance.',
                    color: 'warning',
                    duration: 4000,
                });
                return false;
            }
        }

        const maxMessagesPerDay =
            typeof limits.maxMessagesPerDay === 'number'
                ? limits.maxMessagesPerDay
                : 0;
        if (maxMessagesPerDay > 0) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const startOfDaySec = Math.floor(startOfDay.getTime() / 1000);
            const messageCount = await getDb().messages
                .where('created_at')
                .aboveOrEqual(startOfDaySec)
                .and((msg) => msg.deleted !== true)
                .count();
            if (messageCount >= maxMessagesPerDay) {
                toast.add({
                    title: 'Daily message limit reached',
                    description:
                        'You have reached the maximum messages per day for this instance.',
                    color: 'warning',
                    duration: 4000,
                });
                return false;
            }
        }

        return true;
    }

    /**
     * Purpose:
     * Resolves the effective system prompt content for the current thread.
     *
     * Behavior:
     * - Prefers thread-bound prompt if present
     * - Falls back to active prompt content
     *
     * Constraints:
     * - Returns null when no prompt content is available
     */
    async function getSystemPromptContent(): Promise<string | null> {
        return resolveSystemPromptText({
            threadId: threadIdRef.value,
            activePromptContent: activePromptContent.value,
        });
    }

    // Helpers to reduce duplication and improve clarity/perf
    /**
     * Purpose:
     * Finds the active chat pane context when multi-pane is enabled.
     *
     * Behavior:
     * - Locates the pane bound to the current thread
     * - Returns pane and index for hook emission
     *
     * Constraints:
     * - Returns null when no active pane is available
     */
    function getActivePaneContext(): PaneContext | null {
        try {
            const mpApi = (globalThis as GlobalWithPaneApi).__or3MultiPaneApi;
            if (!mpApi?.panes.value) return null;
            const pane = mpApi.panes.value.find(
                (p) => p.mode === 'chat' && p.threadId === threadIdRef.value
            );
            if (!pane) return null;
            const paneIndex = mpApi.panes.value.indexOf(pane);
            return { mpApi, pane, paneIndex };
        } catch {
            return null;
        }
    }

    /**
     * Purpose:
     * Applies a partial update to a stored message and keeps sync metadata consistent.
     *
     * Behavior:
     * - Loads the current row if not provided
     * - Mirrors error updates into data.error for reliable sync
     * - Updates updated_at timestamp
     *
     * Constraints:
     * - No-op if the message does not exist
     */
    async function updateMessageRecord(
        id: string,
        patch: Partial<StoredMessage>,
        existing?: StoredMessage | null
    ): Promise<void> {
        const base =
            existing ??
            ((await getDb().messages.get(id)) as StoredMessage | undefined);
        if (!base) return;

        // If error is being updated, also update data.error for reliable sync
        // (data uses v.any() and syncs reliably; top-level error may not)
        let finalPatch = patch;
        if ('error' in patch) {
            const baseData = base.data && typeof base.data === 'object'
                ? (base.data as Record<string, unknown>)
                : {};
            const patchData = patch.data && typeof patch.data === 'object'
                ? (patch.data as Record<string, unknown>)
                : {};
            finalPatch = {
                ...patch,
                data: {
                    ...baseData,
                    ...patchData,
                    error: patch.error, // Sync error to data.error
                },
            };
        }

        await upsert.message({
            ...base,
            ...finalPatch,
            updated_at: finalPatch.updated_at ?? nowSec(),
        });
    }

    /**
     * Purpose:
     * Creates a throttled assistant persister for streaming updates.
     *
     * Behavior:
     * - Serializes file hashes only when changes occur
     * - Updates content, reasoning, and tool call data
     * - Clears pending flag on finalize
     *
     * Constraints:
     * - Returned function is stateful and tied to the provided message row
     */
    function makeAssistantPersister(
        assistantDbMsg: StoredMessage,
        assistantFileHashes: string[]
    ) {
        // Cache last serialized file hashes to avoid recomputing on each write
        let lastSerialized: string | null = assistantDbMsg.file_hashes || null;
        return async function persist({
            content,
            reasoning,
            toolCalls,
            finalize = false, // When true, clears pending flag to trigger sync
        }: {
            content?: string;
            reasoning?: string | null;
            toolCalls?: ToolCallInfo[] | null;
            finalize?: boolean;
        }) {
            const baseData =
                assistantDbMsg.data && typeof assistantDbMsg.data === 'object'
                    ? (assistantDbMsg.data as Record<string, unknown>)
                    : {};
            const serialized = assistantFileHashes.length
                ? serializeFileHashes(assistantFileHashes)
                : lastSerialized;
            if (
                serialized !== lastSerialized ||
                content != null ||
                reasoning != null ||
                toolCalls != null ||
                finalize
            ) {
                const payload: StoredMessage = {
                    ...assistantDbMsg,
                    pending: finalize ? false : assistantDbMsg.pending, // Clear pending on finalize
                    data: {
                        ...baseData,
                        content:
                            content ??
                            (typeof baseData.content === 'string'
                                ? baseData.content
                                : ''),
                        reasoning_text:
                            reasoning ??
                            (typeof baseData.reasoning_text === 'string'
                                ? baseData.reasoning_text
                                : null),
                        ...(toolCalls
                            ? {
                                  tool_calls: toolCalls.map((t) => ({ ...t })),
                              }
                            : {}),
                    },
                    file_hashes: serialized,
                    updated_at: nowSec(),
                };
                await upsert.message(payload);
                lastSerialized = serialized ?? null;
            }
            return lastSerialized;
        };
    }

    /**
     * Purpose:
     * Filters assistant messages to prevent empty placeholders in model input.
     *
     * Behavior:
     * - Keeps non-empty text messages
     * - Keeps image/file content parts
     *
     * Constraints:
     * - Only applies to assistant role messages
     */
    function shouldKeepAssistantMessage(m: ChatMessage): boolean {
        if (m.role !== 'assistant') return true;
        const c = m.content;
        if (typeof c === 'string') return c.trim().length > 0;
        if (Array.isArray(c)) {
            return c.some((p) => {
                if (p.type === 'text') return p.text.trim().length > 0;
                // image and file parts are always considered non-empty
                return true;
            });
        }
        return true;
    }

    /**
     * Purpose:
     * Applies workflow output to UI and raw message state when AI is bypassed.
     *
     * Behavior:
     * - Updates in-memory message arrays when possible
     * - Falls back to Dexie read to reconstruct missing entries
     *
     * Constraints:
     * - No-op when message id or output is missing
     */
    async function applyWorkflowResultToMessages(
        messageId: string,
        finalOutput: string
    ) {
        if (!messageId || !finalOutput) return;
        let updated = false;

        const rawIdx = rawMessages.value.findIndex((m) => m.id === messageId);
        const existingRaw = rawIdx !== -1 ? rawMessages.value[rawIdx] : null;
        if (existingRaw) {
            const next: ChatMessage = {
                ...existingRaw,
                role: existingRaw.role,
                content: finalOutput,
            };
            rawMessages.value.splice(rawIdx, 1, next);
            updated = true;
        }

        const uiIdx = messages.value.findIndex((m) => m.id === messageId);
        const existingUi = uiIdx !== -1 ? messages.value[uiIdx] : null;
        if (existingUi) {
            const next: UiChatMessage = { ...existingUi, text: finalOutput };
            messages.value.splice(uiIdx, 1, next);
            updated = true;
        }

        if (!updated && threadIdRef.value) {
            try {
                const row = await getDb().messages.get(messageId);
                if (row && row.thread_id === threadIdRef.value) {
                    const data =
                        (row.data as Record<string, unknown> | null) || null;
                    const content =
                        deriveMessageContent({
                            content: (
                                row as {
                                    content?: string | ContentPart[] | null;
                                }
                            ).content,
                            data,
                        }) || finalOutput;
                    const chatMsg: ChatMessage = {
                        role: row.role as ChatMessage['role'],
                        content,
                        id: row.id,
                        stream_id: row.stream_id ?? undefined,
                        file_hashes: row.file_hashes ?? undefined,
                        reasoning_text:
                            data &&
                            typeof data === 'object' &&
                            typeof (data as { reasoning_text?: unknown })
                                .reasoning_text === 'string'
                                ? (data as { reasoning_text: string })
                                      .reasoning_text
                                : null,
                        data: data || null,
                        index:
                            typeof row.index === 'number'
                                ? row.index
                                : typeof row.index === 'string'
                                ? Number(row.index) || null
                                : null,
                        created_at:
                            typeof row.created_at === 'number'
                                ? row.created_at
                                : null,
                    };
                    rawMessages.value.push(chatMsg);
                    messages.value.push(
                        ensureUiMessage({
                            ...chatMsg,
                            data,
                        })
                    );
                }
            } catch {
                /* intentionally empty */
            }
        }
    }

    cleanupFns.push(
        hooks.on(
            'workflow.execution:action:state_update',
            (payload: {
                messageId: string;
                state?: { executionState?: string; finalOutput?: string };
            }) => {
                const state = payload.state || {};
                const executionState = state.executionState;
                const isDone =
                    executionState &&
                    executionState !== 'running' &&
                    executionState !== 'idle';
                const finalOutput =
                    typeof state.finalOutput === 'string'
                        ? state.finalOutput
                        : '';
                if (!isDone || !finalOutput) return;
                void applyWorkflowResultToMessages(
                    payload.messageId,
                    finalOutput
                );
            }
        )
    );

    let historySyncInFlight = false;
    /**
     * Purpose:
     * Loads thread history into memory and reattaches background jobs if needed.
     *
     * Behavior:
     * - Ensures thread history is loaded once per thread id
     * - Rebuilds UI message list from raw messages
     * - Reattaches background jobs after history sync
     *
     * Constraints:
     * - No-op if a sync is already in flight
     * - Safe to call repeatedly
     */
    async function ensureHistorySynced() {
        if (historySyncInFlight) return;
        if (threadIdRef.value && historyLoadedFor.value !== threadIdRef.value) {
            historySyncInFlight = true;
            try {
                if (detached.value) detached.value = false;
                const { ensureThreadHistoryLoaded } = await import(
                    '~/utils/chat/history'
                );
                await ensureThreadHistoryLoaded(
                    threadIdRef,
                    historyLoadedFor,
                    rawMessages
                );
                messages.value = rawMessages.value
                    .filter((m: ChatMessage) => m.role !== 'tool')
                    .map((m) => ensureUiMessage(m));
                await reattachBackgroundJobs();
            } finally {
                historySyncInFlight = false;
            }
        }
    }

    const tailAssistant = ref<UiChatMessage | null>(null);
    let lastSuppressedAssistantId: string | null = null;
    /**
     * Purpose:
     * Flushes the in-progress assistant message into the UI list.
     *
     * Behavior:
     * - Adds tail assistant to messages if missing
     * - Clears tail reference afterwards
     *
     * Constraints:
     * - No-op when no tail assistant exists
     */
    function flushTailAssistant() {
        const tail = tailAssistant.value;
        if (!tail) return;
        if (!messages.value.find((m) => m.id === tail.id)) {
            messages.value.push(tail);
        }
        tailAssistant.value = null;
    }

    /**
     * Purpose:
     * Resolves a UI message by id, preferring the tail assistant.
     *
     * Behavior:
     * - Returns tail assistant when ids match
     * - Falls back to messages list
     */
    function resolveUiMessage(messageId: string): UiChatMessage | null {
        if (tailAssistant.value?.id === messageId) return tailAssistant.value;
        return messages.value.find((m) => m.id === messageId) ?? null;
    }

    /**
     * Purpose:
     * Clears background job subscriptions and optionally stops tracking.
     *
     * Behavior:
     * - Unsubscribes all background job listeners
     * - Optionally stops tracking of active jobs
     *
     * Constraints:
     * - Safe to call multiple times
     */
    function clearBackgroundJobSubscriptions(options?: {
        keepTracking?: boolean;
    }): void {
        if (!backgroundJobDisposers.length) return;
        for (const jobId of attachedBackgroundJobs) {
            const tracker = backgroundJobTrackers.get(jobId);
            if (tracker && !options?.keepTracking) {
                stopBackgroundJobTracking(tracker);
            }
        }
        for (const dispose of backgroundJobDisposers.splice(0, backgroundJobDisposers.length)) {
            try {
                dispose();
            } catch {
                /* intentionally empty */
            }
        }
        attachedBackgroundJobs.clear();
    }

    /**
     * Purpose:
     * Attaches a background job tracker to UI state and streaming buffers.
     *
     * Behavior:
     * - Ensures tracker exists and seeds baseline content
     * - Subscribes to updates and syncs UI text
     * - Finalizes stream accumulator on completion
     *
     * Constraints:
     * - Only attaches once per job id
     * - Respects detached mode to avoid UI updates
     */
    function attachBackgroundJobToUi(params: {
        jobId: string;
        userId: string;
        messageId: string;
        threadId: string;
        initialContent?: string;
        isReattach?: boolean;
        useSse?: boolean;
    }): BackgroundJobTracker {
        const tracker = ensureBackgroundJobTracker({
            jobId: params.jobId,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
            // Seed with DB content - server must have MORE to update
            initialContent: params.initialContent,
            useSse: params.useSse,
        });
        if (params.isReattach && typeof params.initialContent === 'string') {
            // Set tracker baseline to DB content
            // Server must have MORE content to trigger an update
            if (params.initialContent.length > tracker.lastContent.length) {
                tracker.lastContent = params.initialContent;
                tracker.lastPersistedLength = params.initialContent.length;
            }
            tracker.lastPersistAt = 0;
            // Sync UI with DB content (don't clear it)
            const target = resolveUiMessage(params.messageId);
            if (target && params.initialContent.length > target.text.length) {
                target.text = params.initialContent;
            }
        }
        if (params.isReattach && tailAssistant.value?.id === params.messageId) {
            // Seed stream accumulator with current content
            streamAcc.reset();
            if (params.initialContent) {
                streamAcc.append(params.initialContent, { kind: 'text' });
            }
        }
        if (!attachedBackgroundJobs.has(params.jobId)) {
            const subscriber: BackgroundJobSubscriber = {
                onUpdate: ({ content, delta }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    const currentLen = target.text.length;
                    // Only update if server has MORE content than current UI
                    if (content.length < currentLen) {
                        return;
                    }
                    if (target.pending && delta) target.pending = false;
                    target.text = content;
                    if (tailAssistant.value?.id === params.messageId) {
                        // Replace accumulator with full content
                        streamAcc.reset();
                        streamAcc.append(content, { kind: 'text' });
                    } else if (delta) {
                        messages.value = [...messages.value];
                    }
                },
                onComplete: ({ content }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    target.text = content;
                    target.pending = false;
                    if (tailAssistant.value?.id === params.messageId) {
                        // Ensure stream accumulator has full content before finalizing
                        streamAcc.reset();
                        if (content) {
                            streamAcc.append(content, { kind: 'text' });
                        }
                        streamAcc.finalize();
                    } else {
                        messages.value = [...messages.value];
                    }
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
                onError: ({ status }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    target.pending = false;
                    target.error = status.error || 'Background response failed';
                    if (tailAssistant.value?.id !== params.messageId) {
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({
                        error: new Error(target.error || 'Background response failed'),
                    });
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
                onAbort: () => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    target.pending = false;
                    target.error = 'stopped';
                    if (tailAssistant.value?.id !== params.messageId) {
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({ aborted: true });
                    void updateMessageRecord(params.messageId, {
                        pending: false,
                        error: 'stopped',
                    });
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
            };
            const unsubscribe = subscribeBackgroundJob(tracker, subscriber);
            attachedBackgroundJobs.add(params.jobId);
            backgroundJobDisposers.push(unsubscribe);
            if (params.isReattach && !tracker.polling && !tracker.streaming) {
                // Only prime if polling hasn't started yet
                void primeBackgroundJobUpdate(tracker);
            }
            // If polling is already running, resetting tracker.lastContent = ''
            // will cause next poll to fetch full content automatically
        }
        return tracker;
    }

    /**
     * Purpose:
     * Reattaches background jobs for the current thread after history load.
     *
     * Behavior:
     * - Scans pending assistant messages for active job metadata
     * - Rehydrates trackers and restores UI state
     *
     * Constraints:
     * - No-op when background streaming is disabled
     */
    async function reattachBackgroundJobs(): Promise<void> {
        if (!backgroundStreamingAllowed.value || !threadIdRef.value) return;

        try {
            const dbMessages = (await messagesByThread(threadIdRef.value)) as
                | StoredMessage[]
                | undefined;
            const list = Array.isArray(dbMessages) ? dbMessages : [];
            for (const msg of list) {
                if (msg.role !== 'assistant' || !msg.pending || !msg.data) continue;
                const data = msg.data as Record<string, unknown>;
                const jobId =
                    typeof data.background_job_id === 'string'
                        ? data.background_job_id
                        : null;
                const status =
                    typeof data.background_job_status === 'string'
                        ? data.background_job_status
                        : 'streaming';
                if (!jobId || status !== 'streaming') continue;

                const initialContent =
                    typeof data.content === 'string'
                        ? data.content
                        : typeof msg.content === 'string'
                        ? msg.content
                        : '';

                attachBackgroundJobToUi({
                    jobId,
                    userId: notificationUserId.value,
                    messageId: msg.id,
                    threadId: threadIdRef.value,
                    initialContent,
                    isReattach: true,
                    useSse: backgroundStreamingAllowed.value,
                });

                if (!backgroundJobId.value) backgroundJobId.value = jobId;
                if (backgroundJobMode.value === 'none') {
                    backgroundJobMode.value = 'background';
                }
            }
        } catch {
            /* intentionally empty */
        }
    }

    /**
     * Purpose:
     * Sends a user message, performs validation, and streams an assistant response.
     *
     * Behavior:
     * - Validates API key and client-side limits
     * - Persists user message and builds model input
     * - Orchestrates foreground or background streaming
     *
     * Constraints:
     * - Returns early when message is filtered or blocked
     * - Requires thread id to be initialized before send
     */
    async function sendMessage(
        contentOrParams: string | (SendMessageParams & { content: string }),
        maybeParams?: SendMessageParams
    ) {
        let content: string;
        let sendMessagesParams: SendMessageParams;

        if (typeof contentOrParams === 'string') {
            content = contentOrParams;
            sendMessagesParams = maybeParams || {
                files: [],
                model: DEFAULT_AI_MODEL,
                file_hashes: [],
                online: false,
                context_hashes: [],
            };
        } else {
            content = contentOrParams.content;
            sendMessagesParams = contentOrParams;
        }

        const hasKey =
            Boolean(effectiveApiKey.value) || hasInstanceKey.value;
        if (!hasKey) {
            if (allowUserOverride.value && guestAccessEnabled.value) {
                // Guest access enabled - trigger OpenRouter login
                const openrouter = useOpenRouterAuth();
                openrouter.startLogin();
            } else if (!allowUserOverride.value) {
                useToast().add({
                    title: 'Instance key required',
                    description:
                        'This deployment requires a managed OpenRouter key. Contact your administrator.',
                    color: 'warning',
                    duration: 4000,
                });
            } else {
                // allowUserOverride is true but guestAccessEnabled is false - no action
                // User must authenticate via SSR auth first
                useToast().add({
                    title: 'Sign in required',
                    description:
                        'Please sign in to continue chatting.',
                    color: 'info',
                    duration: 4000,
                });
            }
            return;
        }

        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        if (
            !outgoing ||
            typeof outgoing !== 'string' ||
            outgoing.trim() === ''
        ) {
            useToast().add({
                title: 'Message blocked',
                description: 'Your message was filtered out.',
                duration: 3000,
            });
            return;
        }

        const canSend = await enforceClientLimits(!threadIdRef.value);
        if (!canSend) return;

        if (!threadIdRef.value) {
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {
                    /* intentionally empty */
                }
            }
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                const { catalog } = useModelStore();
                let lastSelected: string | null = null;
                const defaultModelMode: 'lastSelected' | 'fixed' =
                    settingsValue?.defaultModelMode === 'fixed'
                        ? 'fixed'
                        : 'lastSelected';
                try {
                    if (typeof window !== 'undefined')
                        lastSelected = localStorage.getItem(
                            'last_selected_model'
                        );
                } catch {
                    /* intentionally empty */
                }
                const chosen = resolveDefaultModel(
                    {
                        defaultModelMode,
                        fixedModelId: settingsValue?.fixedModelId ?? null,
                    },
                    {
                        isAvailable: (id: string) =>
                            catalog.value.some((m: ModelInfo) => m.id === id),
                        lastSelectedModelId: () => lastSelected,
                        recommendedDefault: () => DEFAULT_AI_MODEL,
                    }
                );
                if (!sendMessagesParams.model) {
                    sendMessagesParams.model = chosen.id;
                }
                if (
                    settingsValue?.defaultModelMode === 'fixed' &&
                    chosen.reason !== 'fixed'
                ) {
                    try {
                        useToast().add({
                            title: 'Model fallback in effect',
                            description:
                                'Your fixed model was not used. Falling back to last selected or default.',
                            duration: 3500,
                        });
                    } catch {
                        /* intentionally empty */
                    }
                }
            } catch {
                /* intentionally empty */
            }
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
            threadIdRef.value = newThread.id;
            // Bind thread to active pane immediately (before first user message hook) if multi-pane present.
            try {
                const mpApi = (globalThis as GlobalWithPaneApi)
                    .__or3MultiPaneApi;
                if (mpApi?.panes.value && mpApi.activePaneIndex.value >= 0) {
                    const pane = mpApi.panes.value[mpApi.activePaneIndex.value];
                    if (pane && pane.mode === 'chat' && !pane.threadId) {
                        if (typeof mpApi.setPaneThread === 'function') {
                            try {
                                await mpApi.setPaneThread(
                                    mpApi.activePaneIndex.value,
                                    newThread.id
                                );
                            } catch {
                                pane.threadId = newThread.id;
                            }
                        } else {
                            pane.threadId = newThread.id;
                        }
                    }
                }
            } catch {
                /* intentionally empty */
            }
        } // END create-new-thread block

        if (
            tailAssistant.value &&
            lastSuppressedAssistantId &&
            tailAssistant.value.id === lastSuppressedAssistantId
        ) {
            tailAssistant.value = null;
            lastSuppressedAssistantId = null;
        } else {
            flushTailAssistant();
            lastSuppressedAssistantId = null; // clear in normal path too
        }

        const prevAssistantRaw = [...rawMessages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        const prevAssistant = prevAssistantRaw
            ? messages.value.find((m) => m.id === prevAssistantRaw.id)
            : null;
        const assistantHashes = prevAssistantRaw?.file_hashes
            ? parseHashes(prevAssistantRaw.file_hashes)
            : [];

        streamAcc.reset();
        let { files, model, file_hashes } = sendMessagesParams;
        const { extraTextParts, online, context_hashes } = sendMessagesParams;
        const extendedParams = sendMessagesParams as ExtendedSendMessageParams;
        if (
            (!files || files.length === 0) &&
            Array.isArray(extendedParams.images)
        ) {
            files = extendedParams.images
                .map((img) => {
                    const url = typeof img === 'string' ? img : img.url;
                    if (!url) return null;
                    const provided =
                        typeof img === 'object' ? img.type : undefined;
                    const type =
                        inferMimeFromUrl(url, provided) ||
                        provided ||
                        'application/octet-stream';
                    return { type, url };
                })
                .filter(
                    (
                        f
                    ): f is {
                        type: string;
                        url: string;
                    } => Boolean(f && f.url && f.type)
                );
        }
        if (!model) model = DEFAULT_AI_MODEL;
        if (online === true) model = model + ':online';

        file_hashes = mergeAssistantFileHashes(assistantHashes, file_hashes);

        // Verify files exist (no Base64 conversion - that happens in buildOpenRouterMessages)
        const hydratedFiles = await Promise.all(
            Array.isArray(files) ? files.map(normalizeFileUrl) : []
        );

        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes: file_hashes.length
                ? serializeFileHashes(file_hashes)
                : undefined,
        });
        const parts: ContentPart[] = buildParts(
            outgoing,
            hydratedFiles,
            extraTextParts
        );
        const rawUser: ChatMessage = {
            role: 'user',
            content: parts,
            id: userDbMsg.id,
            file_hashes: userDbMsg.file_hashes,
        };
        recordRawMessage(rawUser);
        rawMessages.value.push(rawUser);
        messages.value.push(ensureUiMessage(rawUser));

        try {
            const ctx = getActivePaneContext();
            if (ctx) {
                void hooks.doAction('ui.pane.msg:action:sent', {
                    pane: ctx.pane,
                    paneIndex: ctx.paneIndex,
                    message: {
                        id: userDbMsg.id,
                        threadId: threadIdRef.value,
                        length: outgoing.length,
                        fileHashes: userDbMsg.file_hashes || null,
                    },
                });
            }
        } catch (e) {
            if (import.meta.dev) {
                console.warn('[useChat] pane hook failed', e);
            }
        }

        loading.value = true;
        streamId.value = undefined;
        backgroundJobId.value = null;
        detached.value = false;

        let currentModelId: string | undefined;
        try {
            const startedAt = Date.now();
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );
            currentModelId = modelId;

            const messagesWithSystemRaw = [...rawMessages.value];
            let masterPrompt = '';
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                masterPrompt = settingsValue?.masterSystemPrompt ?? '';
            } catch {
                masterPrompt = '';
            }
            const systemMessage = await buildSystemPromptMessage({
                threadId: threadIdRef.value,
                activePromptContent: activePromptContent.value,
                masterPrompt,
            });
            if (systemMessage) {
                messagesWithSystemRaw.unshift(systemMessage);
            }

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messagesWithSystemRaw
            );

            // Remove prior empty assistant placeholder messages
            const sanitizedEffectiveMessages = (
                Array.isArray(effectiveMessages) ? effectiveMessages : []
            ).filter(shouldKeepAssistantMessage);

            // Load thread history if not already loaded
            await ensureHistorySynced();
            let orMessages = await buildOpenRouterMessagesForSend({
                effectiveMessages: sanitizedEffectiveMessages,
                assistantHashes,
                prevAssistantId: prevAssistant?.id,
                contextHashes: context_hashes,
                fileHashes: Array.isArray(file_hashes) ? file_hashes : [],
                maxImageInputs: 16,
                imageInclusionPolicy: 'all',
            });
            if (orMessages.length === 0) return;

            // modalities controls OUTPUT format, not input capability
            // Only request image output for actual image generation models
            const isImageGenerationModel = /dall-e|stable-diffusion|midjourney|imagen/i.test(modelId);
            const modalities = isImageGenerationModel ? ['image', 'text'] : ['text'];

            const newStreamId = newId();
            streamId.value = newStreamId;
            const assistantDbMsg = (await tx.appendMessage({
                thread_id: threadIdRef.value,
                role: 'assistant',
                stream_id: newStreamId,
                pending: true, // Mark as streaming - HookBridge will skip sync until finalized
                data: { content: '', attachments: [], reasoning_text: null },
            })) as StoredMessage;
            // Track file hashes across loop iterations
            const assistantFileHashes: string[] = [];
            const persistAssistant = makeAssistantPersister(
                assistantDbMsg,
                assistantFileHashes
            );

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? effectiveMessages.length
                    : undefined,
            });

            const toolRegistry = useToolRegistry();
            const enabledToolDefs = toolRegistry.getEnabledDefinitions();

            // Track tool calls across all loop iterations (persists state)
            const activeToolCalls = new Map<string, ToolCallInfo>();

            aborted.value = false;
            abortController.value = null;
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;

            const filteredMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:before_send',
                { messages: orMessages }
            );

            if (
                typeof filteredMessages === 'object' &&
                'messages' in filteredMessages
            ) {
                const candidate = (
                    filteredMessages as {
                        messages?: OpenRouterMessage[];
                    }
                ).messages;
                if (Array.isArray(candidate)) {
                    orMessages = candidate;
                }
            }

            // Check if a workflow is handling this request - skip AI call
            if (consumeWorkflowHandlingFlag()) {
                // Seed UI with assistant placeholder so workflow state can render immediately
                const workflowAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };
                recordRawMessage(workflowAssistant);
                rawMessages.value.push(workflowAssistant);
                const uiAssistant = ensureUiMessage(workflowAssistant);
                uiAssistant.pending = true;
                messages.value.push(uiAssistant);
                loading.value = false;
                abortController.value = null;
                return;
            }

            // Also skip if messages array is empty (e.g., workflow returned empty)
            if (orMessages.length === 0) {
                loading.value = false;
                return;
            }

            const allowBackgroundStreaming =
                backgroundStreamingAllowed.value &&
                enabledToolDefs.length === 0 &&
                modalities.length === 1 &&
                modalities[0] === 'text';

            if (allowBackgroundStreaming) {
                backgroundJobMode.value = 'background';

                const rawAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };

                recordRawMessage(rawAssistant);
                rawMessages.value.push(rawAssistant);
                const uiAssistant = ensureUiMessage(rawAssistant);
                uiAssistant.pending = true;
                tailAssistant.value = uiAssistant;

                try {
                    const result = await startBackgroundStream({
                        apiKey: effectiveApiKey.value,
                        model: modelId,
                        orMessages: orMessages as Parameters<
                            typeof startBackgroundStream
                        >[0]['orMessages'],
                        modalities,
                        threadId: threadIdRef.value!,
                        messageId: assistantDbMsg.id,
                        tools:
                            enabledToolDefs.length > 0
                                ? enabledToolDefs
                                : undefined,
                    });

                    backgroundJobId.value = result.jobId;
                    backgroundJobInfo.value = {
                        jobId: result.jobId,
                        threadId: threadIdRef.value!,
                        messageId: assistantDbMsg.id,
                    };

                    if (assistantDbMsg.data && typeof assistantDbMsg.data === 'object') {
                        assistantDbMsg.data = {
                            ...(assistantDbMsg.data as Record<string, unknown>),
                            background_job_id: result.jobId,
                            background_job_status: 'streaming',
                        };
                    } else {
                        assistantDbMsg.data = {
                            background_job_id: result.jobId,
                            background_job_status: 'streaming',
                        } as Record<string, unknown>;
                    }
                    await updateMessageRecord(assistantDbMsg.id, {
                        data: {
                            background_job_id: result.jobId,
                            background_job_status: 'streaming',
                        },
                    });

                    const tracker = attachBackgroundJobToUi({
                        jobId: result.jobId,
                        userId: notificationUserId.value,
                        messageId: assistantDbMsg.id,
                        threadId: threadIdRef.value!,
                        initialContent: '',
                        useSse: backgroundStreamingAllowed.value,
                    });

                    await tracker.completion;
                } catch (error) {
                    const errMessage =
                        error instanceof Error
                            ? error.message
                            : 'Background stream failed';
                    const target = resolveUiMessage(assistantDbMsg.id);
                    if (target) {
                        target.pending = false;
                        target.error = errMessage;
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({ error: new Error(errMessage) });
                    loading.value = false;
                    backgroundJobId.value = null;
                    backgroundJobMode.value = 'none';
                    backgroundJobInfo.value = null;
                }

                return;
            }

            abortController.value = new AbortController();

            await runForegroundStreamLoop({
                apiKey: effectiveApiKey.value,
                modelId,
                orMessages,
                modalities,
                tools:
                    enabledToolDefs.length > 0
                        ? enabledToolDefs
                        : undefined,
                abortSignal: abortController.value.signal,
                assistantId: assistantDbMsg.id,
                streamId: newStreamId,
                threadId: threadIdRef.value!,
                streamAcc,
                hooks,
                toolRegistry,
                persistAssistant,
                assistantFileHashes,
                activeToolCalls,
                tailAssistant,
                rawMessages,
            });

            const current = tailAssistant.value!;
            const fullText = current.text;
            const hookName = 'ui.chat.message:filter:incoming';
            const errorsBefore = hooks._diagnostics.errors[hookName] ?? 0;
            const incoming = await hooks.applyFilters(
                hookName,
                fullText,
                threadIdRef.value
            );
            const errorsAfter = hooks._diagnostics.errors[hookName] ?? 0;
            if (errorsAfter > errorsBefore) {
                throw new Error('Incoming filter threw an exception');
            }
            if (current.pending) current.pending = false;
            current.text = incoming;
            await persistAssistant({
                content: incoming,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                finalize: true, // Clear pending flag to trigger sync
            });
            const finalized: StoredMessage = {
                ...assistantDbMsg,
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : assistantDbMsg.file_hashes,
            };
            await hooks.doAction('ai.chat.stream:action:complete', {
                threadId: threadIdRef.value,
                assistantId: assistantDbMsg.id,
                streamId: newStreamId,
                totalLength: incoming.length,
                reasoningLength: (current.reasoning_text || '').length,
                fileHashes: finalized.file_hashes || null,
            });
            try {
                const ctx = getActivePaneContext();
                if (ctx) {
                    void hooks.doAction('ui.pane.msg:action:received', {
                        pane: ctx.pane,
                        paneIndex: ctx.paneIndex,
                        message: {
                            id: finalized.id,
                            threadId: threadIdRef.value,
                            length: incoming.length,
                            fileHashes: finalized.file_hashes || null,
                            reasoningLength: (current.reasoning_text || '')
                                .length,
                        },
                    });
                }
            } catch {
                /* intentionally empty */
            }
            const endedAt = Date.now();
            await hooks.doAction('ai.chat.send:action:after', {
                threadId: threadIdRef.value,
                request: { modelId, userId: userDbMsg.id },
                response: {
                    assistantId: assistantDbMsg.id,
                    length: incoming.length,
                },
                timings: {
                    startedAt,
                    endedAt,
                    durationMs: endedAt - startedAt,
                },
                aborted: false,
            });
            streamAcc.finalize();
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                if (isDetached()) return;
            }
            if (aborted.value) {
                if (tailAssistant.value?.pending)
                    tailAssistant.value.pending = false;
                try {
                    await hooks.doAction('ai.chat.send:action:after', {
                        threadId: threadIdRef.value,
                        aborted: true,
                    });
                } catch (e) {
                    if (import.meta.dev) {
                        console.warn('[useChat] abort hook failed', e);
                    }
                }
                // Only delete if there's no text; otherwise preserve with 'stopped' status
                if (tailAssistant.value?.id && !tailAssistant.value.text) {
                    try {
                        await getDb().messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch (e) {
                        if (import.meta.dev) {
                            console.warn(
                                '[useChat] failed to delete empty assistant',
                                e
                            );
                        }
                    }
                    tailAssistant.value = null;
                } else if (
                    tailAssistant.value?.id &&
                    tailAssistant.value.text
                ) {
                    // Preserve partial message with 'stopped' status for continue functionality
                    tailAssistant.value.pending = false;
                    tailAssistant.value.error = 'stopped';

                    // Add to messages array if not already there (flush before nulling)
                    if (
                        !messages.value.find(
                            (m) => m.id === tailAssistant.value!.id
                        )
                    ) {
                        messages.value.push(tailAssistant.value);
                    } else {
                        // Update existing message in array
                        const msgIdx = messages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (msgIdx >= 0) {
                            messages.value[msgIdx] = { ...tailAssistant.value };
                        }
                    }

                    const rawIdx = rawMessages.value.findIndex(
                        (m) => m.id === tailAssistant.value!.id
                    );
                    if (rawIdx >= 0) {
                        const existingRaw = rawMessages.value[rawIdx];
                        if (existingRaw) {
                            rawMessages.value[rawIdx] = {
                                ...existingRaw,
                                content: tailAssistant.value.text,
                                error: 'stopped',
                            };
                        }
                    }
                    try {
                        const existing = (await getDb().messages.get(
                            tailAssistant.value.id
                        )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            tailAssistant.value.id,
                            {
                                pending: false, // Clear pending so sync captures this
                                data: {
                                    ...baseData,
                                    content: tailAssistant.value.text,
                                    reasoning_text:
                                        tailAssistant.value.reasoning_text ??
                                        null,
                                    error: 'stopped', // Store in data for reliable sync
                                },
                                error: 'stopped', // Also at top-level for local reads
                            },
                            existing
                        );
                    } catch {
                        /* intentionally empty */
                    }
                    tailAssistant.value = null;
                }
            } else {
                const lastUser = [...messages.value]
                    .reverse()
                    .find((m) => m.role === 'user');
                const retryFn = lastUser
                    ? () => {
                          void retryMessage(lastUser.id);
                      }
                    : undefined;
                // Inline tag object (Req 18.1) for clarity & tree-shaking
                reportError(err, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: threadIdRef.value || '',
                        streamId: streamId.value || '',
                        modelId: currentModelId || '',
                        stage: 'stream',
                    },
                    retry: retryFn,
                    toast: true,
                    retryable: !!retryFn,
                });
                const e = err instanceof Error ? err : new Error(String(err));
                streamAcc.finalize({ error: e });
                await hooks.doAction('ai.chat.stream:action:error', {
                    threadId: threadIdRef.value,
                    streamId: streamId.value,
                    error: e,
                    aborted: false,
                });
                if (!tailAssistant.value?.text && tailAssistant.value?.id) {
                    try {
                        await getDb().messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch {
                        /* intentionally empty */
                    }
                    tailAssistant.value = null;
                } else if (
                    tailAssistant.value?.id &&
                    tailAssistant.value.text
                ) {
                    tailAssistant.value.pending = false;
                    tailAssistant.value.error = 'stream_interrupted';
                    const rawIdx = rawMessages.value.findIndex(
                        (m) => m.id === tailAssistant.value!.id
                    );
                    if (rawIdx >= 0) {
                        const existingRaw = rawMessages.value[rawIdx];
                        if (existingRaw) {
                            rawMessages.value[rawIdx] = {
                                ...existingRaw,
                                error: 'stream_interrupted',
                            };
                        }
                    }
                    try {
                        const existing = (await getDb().messages.get(
                            tailAssistant.value.id
                        )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            tailAssistant.value.id,
                            {
                                pending: false, // Clear pending so sync captures this
                                data: {
                                    ...baseData,
                                    content: tailAssistant.value.text,
                                    reasoning_text:
                                        tailAssistant.value.reasoning_text ??
                                        null,
                                    error: 'stream_interrupted', // Store in data for reliable sync
                                },
                                error: 'stream_interrupted', // Also at top-level for local reads
                            },
                            existing
                        );
                    } catch {
                        /* intentionally empty */
                    }
                } else if (tailAssistant.value?.pending) {
                    tailAssistant.value.pending = false;
                }
            }
        } finally {
            loading.value = false;
            // CRITICAL: Ensure abort controller is cleaned up to prevent memory leak
            if (abortController.value) {
                abortController.value = null;
            }
            setTimeout(() => {
                if (!loading.value && streamState.finalized) resetStream();
            }, 0);
        }
    }

    // END sendMessage

    /**
     * Purpose:
     * Retries a prior user message by removing its assistant response and resending.
     *
     * Behavior:
     * - Rebuilds message context from local state
     * - Reuses the current settings unless a model override is supplied
     *
     * Constraints:
     * - No-op if message or thread context is missing
     */
    async function retryMessage(messageId: string, modelOverride?: string) {
        await retryMessageImpl(
            {
                loading,
                threadIdRef,
                tailAssistant,
                rawMessages,
                messages,
                hooks,
                sendMessage,
                defaultModelId: DEFAULT_AI_MODEL,
                suppressNextTailFlush: (assistantId: string) => {
                    lastSuppressedAssistantId = assistantId;
                },
            },
            messageId,
            modelOverride
        );
    }

    /**
     * Purpose:
     * Continues a partially generated assistant message.
     *
     * Behavior:
     * - Builds a continuation prompt from recent assistant output
     * - Streams new content into the existing assistant message
     *
     * Constraints:
     * - Requires an existing assistant message id
     */
    async function continueMessage(messageId: string, modelOverride?: string) {
        await continueMessageImpl(
            {
                loading,
                aborted,
                abortController,
                threadIdRef,
                tailAssistant,
                rawMessages,
                messages,
                streamId,
                streamAcc,
                streamState,
                hooks,
                effectiveApiKey,
                hasInstanceKey,
                defaultModelId: DEFAULT_AI_MODEL,
                getSystemPromptContent,
                useAiSettings,
                resetStream,
            },
            messageId,
            modelOverride
        );
    }

    /**
     * Purpose:
     * Clears local chat state and tears down subscriptions.
     *
     * Behavior:
     * - Aborts active streams when safe
     * - Clears UI and raw message arrays
     * - Disposes hook listeners and background job subscriptions
     *
     * Constraints:
     * - In background mode, detaches without stopping the job
     */
    function clear() {
        const disposeHooks = () => {
            if (!cleanupFns.length) return;
            for (const dispose of cleanupFns.splice(0, cleanupFns.length)) {
                try {
                    dispose();
                } catch {
                    /* intentionally empty */
                }
            }
        };

        const isBackgroundActive =
            backgroundStreamingAllowed.value &&
            (backgroundJobId.value || backgroundJobMode.value !== 'none');

        if (isBackgroundActive) {
            detached.value = true;
            clearBackgroundJobSubscriptions({ keepTracking: true });
            disposeHooks();
            // Do NOT reset backgroundJobId, backgroundJobMode, or backgroundJobInfo
            // This allows reattachment or background processing to continue
            return;
        }
        if (abortController.value) {
            // CRITICAL: Abort any active stream before clearing to prevent memory leaks
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch (e) {
                if (import.meta.dev) {
                    console.warn(
                        '[useChat] abort controller cleanup failed',
                        e
                    );
                }
            }
            streamAcc.finalize({ aborted: true });
            abortController.value = null;
        }

        clearBackgroundJobSubscriptions();

        // Clean up any registered hooks to avoid leaking listeners across threads
        disposeHooks();

        rawMessages.value = [];
        messages.value = [];
        streamAcc.reset();
    }

    /**
     * Purpose:
     * Applies a local text edit to in-memory message state.
     *
     * Behavior:
     * - Updates raw and UI message caches
     * - Updates tail assistant if it matches
     *
     * Constraints:
     * - Does not persist to IndexedDB
     */
    function applyLocalEdit(id: string, text: string) {
        let updated = false;
        const rawIdx = rawMessages.value.findIndex((m) => m.id === id);
        const raw = rawIdx !== -1 ? rawMessages.value[rawIdx] : undefined;
        if (raw) {
            if (Array.isArray(raw.content)) {
                raw.content = raw.content.map((p) =>
                    p.type === 'text' ? { ...p, text } : p
                );
            } else {
                raw.content = text;
            }
            rawMessages.value = [...rawMessages.value];
            updated = true;
        }
        const uiIdx = messages.value.findIndex((m) => m.id === id);
        if (uiIdx !== -1) {
            const uiMsg = messages.value[uiIdx];
            if (uiMsg) {
                uiMsg.text = text;
                messages.value = [...messages.value];
                updated = true;
            }
        }
        if (tailAssistant.value?.id === id) {
            tailAssistant.value.text = text;
            updated = true;
        }
        return updated;
    }

    void reattachBackgroundJobs();

    onScopeDispose(() => {
        clear();
    });

    /**
     * Purpose:
     * Aborts any active streaming request and finalizes state.
     *
     * Behavior:
     * - Aborts foreground streams or background jobs
     * - Marks partial messages as stopped
     * - Emits abort error telemetry when configured
     *
     * Constraints:
     * - No-op if no active stream is present
     */
    function abortChat() {
        if (backgroundJobId.value) {
            const jobId = backgroundJobId.value;
            const info = backgroundJobInfo.value;
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;
            aborted.value = true;
            void abortBackgroundJob(jobId);
            if (abortController.value) {
                try {
                    abortController.value.abort();
                } catch {
                    /* intentionally empty */
                }
                abortController.value = null;
            }
            streamAcc.finalize({ aborted: true });
            if (tailAssistant.value?.pending)
                tailAssistant.value.pending = false;
            if (info?.messageId) {
                const target = resolveUiMessage(info.messageId);
                if (target) {
                    target.pending = false;
                    target.error = 'stopped';
                    messages.value = [...messages.value];
                }
                void updateMessageRecord(info.messageId, {
                    pending: false,
                    error: 'stopped',
                });
            }
            return;
        }

        if (!loading.value || !abortController.value) return;
        aborted.value = true;
        try {
            abortController.value.abort();
        } catch {
            /* intentionally empty */
        }
        streamAcc.finalize({ aborted: true });
        if (tailAssistant.value?.pending)
            tailAssistant.value.pending = false;
        try {
            const appConfig = useAppConfig() as {
                errors?: { showAbortInfo?: boolean };
            };
            const showAbort =
                typeof appConfig.errors === 'object' &&
                appConfig.errors.showAbortInfo === true;
            reportError(
                err('ERR_STREAM_ABORTED', 'Generation aborted', {
                    severity: 'info',
                    tags: {
                        domain: 'chat',
                        threadId: threadIdRef.value || '',
                        streamId: streamId.value || '',
                        stage: 'abort',
                    },
                }),
                { code: 'ERR_STREAM_ABORTED', toast: showAbort }
            );
        } catch {
            /* intentionally empty */
        }
    }

    return {
        messages,
        rawMessages,
        sendMessage,
        send: sendMessage,
        retryMessage,
        continueMessage,
        loading,
        backgroundJobId,
        backgroundJobMode,
        threadId: threadIdRef,
        streamId,
        resetStream,
        streamState,
        tailAssistant,
        flushTailAssistant,
        applyLocalEdit,
        ensureHistorySynced,
        abort: abortChat,
        clear,
    };
}
