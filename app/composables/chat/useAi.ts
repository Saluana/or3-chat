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

import { ref, computed, watch, onScopeDispose, getCurrentScope } from 'vue';
import { useToast, useAppConfig, useRuntimeConfig } from '#imports';
import { nowSec, newId, getWriteTxTableNames } from '~/db/util';
import { type Message } from '~/db';
import { getDb, getActiveWorkspaceId, type Or3DB } from '~/db/client';
import { serializeFileHashes } from '~/db/files-util';
import { normalizeFileUrl } from '~/utils/chat/useAi-internal/files';
import {
    parseHashes,
    mergeAssistantFileHashes,
} from '~/utils/files/attachments';
import { appendMessageToDb, messagesByThread } from '~/db/messages';
import { createThreadInDb } from '~/db/threads';
import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
    SendResult,
    ChatRequestState,
} from '~/utils/chat/types';
import { ToolIterationLimitError } from '~~/shared/chat/stream-errors';
import { MAX_CANONICAL_MESSAGE_OUTPUT_BYTES } from '~~/shared/chat/tool-limits';
import { redactDiagnosticDetails } from '~~/shared/logging/sensitive-metadata';
import type { ToolLedgerEntry } from '~~/shared/chat/tool-ledger';
import {
    isStaleForegroundGeneration,
    remainingForegroundLeaseMs,
    createForegroundGenerationLease,
} from '~/utils/chat/generation-lease';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import {
    buildParts,
    deriveMessageContent,
    shouldKeepAssistantMessage,
    getChatModalities,
    resolveChatInputTokenBudget,
} from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import {
    startBackgroundStream,
    abortBackgroundJob,
    abortBackgroundAdmission,
    pollJobStatus,
    isBackgroundStreamingEnabled,
    isBackgroundClientToolBridgeAvailable,
    type BackgroundJobStatus,
    type OpenRouterReasoningConfig,
} from '../../utils/chat/openrouterStream';
import { resolveReasoningConfig } from '~~/shared/openrouter/reasoning';
import {
    appendModelVariant,
    stripModelVariantSuffix,
} from '~~/shared/openrouter/model-variants';
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
import { useHooks } from '#imports';
import { consumeChatSendHandled } from '~/utils/chat/send-interception';
import { DEFAULT_PROMPT_SELECTION } from '~/utils/chat/prompt-utils';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
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
    buildOpenRouterMessagesForSend,
    enforceOpenRouterMessageTokenBudget,
    retryMessageImpl,
    continueMessageImpl,
    makeAssistantPersister,
    updateMessageRecord,
    projectCanonicalBackgroundMessage,
    reloadTurnIntoRawMessages,
} from '~/utils/chat/useAi-internal';
import {
    assistantTranscriptData,
    userTranscriptData,
} from '~/utils/chat/transcript';

const DEFAULT_AI_MODEL = '~openai/gpt-luna-latest';

const THINKING_SUFFIX = ':thinking';

function stripThinkingSuffix(modelId: string): string {
    return modelId.endsWith(THINKING_SUFFIX)
        ? modelId.slice(0, -THINKING_SUFFIX.length)
        : modelId;
}

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

type ChatHistoryModule = typeof import('~/utils/chat/history');

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
    pendingPromptId?: string,
    options: { historyAlreadyLoaded?: boolean } = {}
) {
    // Messages and basic state
    const messages = ref<UiChatMessage[]>(msgs.map((m) => ensureUiMessage(m)));
    const rawMessages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const requestState = ref<ChatRequestState>({ status: 'idle' });
    let activeRequestId: string | null = null;
    const abortController = ref<AbortController | null>(null);
    const aborted = ref<boolean>(false);
    const { apiKey, setKey } = useUserApiKey();
    const runtimeConfig = useRuntimeConfig();
    // Nuxt UI resolves its toast service through Vue injection. Capture it
    // while useChat is still running inside setup; calling useToast() later
    // from an async send handler triggers Vue's "inject() can only be used
    // inside setup()" warning.
    const toast = useToast();
    const appConfig = useAppConfig() as {
        errors?: { showAbortInfo?: boolean };
    };
    const openRouterAuth = useOpenRouterAuth();
    const syncConfig = runtimeConfig.public.sync;
    /**
     * When canonical sync history exists, generated output is bounded before
     * emission so a completed answer can always be committed. Local-only
     * workspaces keep the larger in-memory stream cap.
     */
    const canonicalOutputLimitBytes =
        runtimeConfig.public.ssrAuthEnabled === true &&
        syncConfig.enabled === true
            ? MAX_CANONICAL_MESSAGE_OUTPUT_BYTES
            : undefined;
    const serverNotificationsEnabled = computed(
        () =>
            runtimeConfig.public.ssrAuthEnabled === true &&
            syncConfig.enabled === true &&
            syncConfig.provider === CONVEX_PROVIDER_ID &&
            Boolean(syncConfig.convexUrl)
    );
    const sessionContext =
        runtimeConfig.public.ssrAuthEnabled === true
            ? useSessionContext()
            : null;
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
    // Mutable so ChatContainer can update without re-calling useChat() outside setup.
    const pendingPromptIdRef = ref<string | undefined>(pendingPromptId);
    const historyLoadedFor = ref<string | null>(
        options.historyAlreadyLoaded && initialThreadId ? initialThreadId : null
    );
    const cleanupFns: Array<() => void> = [];
    const backgroundStreamDebugEnabled = (): boolean => {
        if (import.meta.dev) return true;
        if (typeof localStorage === 'undefined') return false;
        try {
            return (
                localStorage.getItem('or3:debug:background-stream') === 'true'
            );
        } catch {
            return false;
        }
    };
    const logBgStream = (
        stage: string,
        details?: Record<string, unknown>
    ): void => {
        if (!backgroundStreamDebugEnabled()) return;
        console.debug('[bg-stream]', stage, redactDiagnosticDetails(details));
    };
    const warnBgStream = (
        stage: string,
        details?: Record<string, unknown>
    ): void => {
        if (!backgroundStreamDebugEnabled()) return;
        console.warn('[bg-stream]', stage, redactDiagnosticDetails(details));
    };

    watch(
        () => notificationUserId.value,
        (nextUserId) => {
            if (!nextUserId) return;
            logBgStream('notification-user-sync', {
                threadId: threadIdRef.value || null,
                nextUserId,
                trackerCount: backgroundJobTrackers.size,
            });
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
    type ChatRequestScope = {
        requestId: string;
        originDb: Or3DB;
        workspaceId: string;
        accumulator: typeof streamAcc;
        /** Thread selected when the request was admitted (or created for it). */
        threadId?: string;
        /** Assistant row this request owns (for cancellation before job ID). */
        assistantMessageId?: string;
        /** Stable admission identity persisted before the start request. */
        backgroundAdmissionId?: string;
        /** Set when navigation supersedes an admission before it can stream. */
        cancelled: boolean;
        settled: Promise<void>;
        resolveSettled: () => void;
        streamId?: string;
        /** Assistant row whose detached workflow may finish after sendMessage. */
        workflowMessageId?: string;
        abortController: AbortController | null;
        toolLedger: Map<string, ToolLedgerEntry>;
        persistAssistant?: ReturnType<typeof makeAssistantPersister>;
    };
    let activeRequestScope: ChatRequestScope | null = null;
    /**
     * Monotonic navigation counter. Long-running async work (reattachment,
     * recovery) snapshots this before awaiting and validates it afterwards so
     * an A -> B -> A switch cannot be mistaken for "still on the same thread".
     */
    let navigationRevision = 0;
    function bumpNavigationRevision(): void {
        navigationRevision += 1;
    }
    /**
     * True only while this request still owns the visible conversation. Used to
     * guard every asynchronous mutation of shared UI state (loading, tail,
     * background controls, accumulator presentation).
     */
    function ownsCurrentView(scope: ChatRequestScope): boolean {
        return (
            !scope.cancelled &&
            activeRequestScope === scope &&
            Boolean(scope.threadId) &&
            threadIdRef.value === scope.threadId
        );
    }
    type WorkflowMessageScope = Pick<
        ChatRequestScope,
        'originDb' | 'workspaceId' | 'threadId'
    >;
    // Workflow execution is detached from sendMessage, so its terminal hook
    // can run after activeRequestScope has been cleared. Keep only the
    // immutable DB/workspace/thread authority needed to hydrate that result.
    const workflowMessageScopes = new Map<string, WorkflowMessageScope>();
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

    const backgroundStreamingConfig = computed(
        () =>
            (
                runtimeConfig.public as {
                    backgroundStreaming?: {
                        enabled?: boolean;
                    };
                }
            ).backgroundStreaming
    );
    const backgroundStreamingAllowed = computed(() => {
        if (runtimeConfig.public.ssrAuthEnabled !== true) return false;
        if (syncConfig.enabled !== true) return false;
        if (backgroundStreamingConfig.value?.enabled !== true) return false;
        if (
            !isBackgroundStreamingEnabled(
                backgroundStreamingConfig.value?.enabled
            )
        )
            return false;
        const session = sessionContext
            ? (sessionContext.data.value?.session ?? null)
            : null;
        if (!session) return false;
        return Boolean(session.authenticated && session.workspace?.id);
    });

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

        const maxConversations =
            typeof limits.maxConversations === 'number'
                ? limits.maxConversations
                : 0;
        if (isNewThread && maxConversations > 0) {
            const threadCount = await getDb()
                .threads.filter((thread) => thread.deleted !== true)
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
            const messageCount = await getDb()
                .messages.where('created_at')
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

        const workflowScope = workflowMessageScopes.get(messageId);
        // A terminal event is global. Never fall back to the currently active
        // request: a late event for an old message could otherwise mutate a
        // different request or workspace that reused its id.
        if (!workflowScope) return;
        const originDb = workflowScope.originDb;
        const originWorkspaceId = workflowScope.workspaceId;
        const originThreadId = workflowScope.threadId;
        if (!originThreadId || threadIdRef.value !== originThreadId) return;

        const ownsCurrentView = () =>
            threadIdRef.value === originThreadId &&
            getDb() === originDb &&
            (getActiveWorkspaceId() ?? 'local') === originWorkspaceId;

        // Read the persisted row before changing either projection. Generated
        // workflow images append their hashes in this row after the workflow
        // message placeholder was rendered.
        let persistedRow: StoredMessage | null = null;
        try {
            const row = (await originDb.messages.get(messageId)) as
                | StoredMessage
                | undefined;
            if (row && row.thread_id !== originThreadId) return;
            persistedRow = row ?? null;
        } catch {
            // Preserve the existing live text update when a read is
            // temporarily unavailable; the durable row remains authoritative.
        }
        if (!ownsCurrentView()) return;

        const persistedFileHashes =
            persistedRow?.file_hashes !== null &&
            persistedRow?.file_hashes !== undefined
                ? persistedRow.file_hashes
                : undefined;
        let updated = false;

        const rawIdx = rawMessages.value.findIndex((m) => m.id === messageId);
        const existingRaw = rawIdx !== -1 ? rawMessages.value[rawIdx] : null;
        if (existingRaw) {
            const next: ChatMessage = {
                ...existingRaw,
                role: existingRaw.role,
                content: finalOutput,
                file_hashes: persistedFileHashes ?? existingRaw.file_hashes,
            };
            rawMessages.value.splice(rawIdx, 1, next);
            updated = true;
        }

        const uiIdx = messages.value.findIndex((m) => m.id === messageId);
        const existingUi = uiIdx !== -1 ? messages.value[uiIdx] : null;
        if (existingUi) {
            const liveFileHashes =
                persistedFileHashes ?? existingRaw?.file_hashes;
            const next: UiChatMessage = {
                ...existingUi,
                text: finalOutput,
                file_hashes:
                    liveFileHashes !== null && liveFileHashes !== undefined
                        ? parseHashes(liveFileHashes)
                        : existingUi.file_hashes,
            };
            messages.value.splice(uiIdx, 1, next);
            updated = true;
        }

        if (!updated && persistedRow) {
            try {
                const row = persistedRow;
                if (row.thread_id === originThreadId) {
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
                if (!isDone) return;
                if (!finalOutput) {
                    workflowMessageScopes.delete(payload.messageId);
                    return;
                }
                void applyWorkflowResultToMessages(
                    payload.messageId,
                    finalOutput
                ).finally(() => {
                    workflowMessageScopes.delete(payload.messageId);
                });
            }
        )
    );

    let historySyncInFlight = false;
    let historySyncQueued = false;
    let historyModulePromise: Promise<ChatHistoryModule> | null = null;
    const getHistoryModule = async (): Promise<ChatHistoryModule> => {
        if (!historyModulePromise) {
            historyModulePromise = import('~/utils/chat/history').catch(
                (error) => {
                    // A Vite dev-server restart can invalidate a lazy module
                    // URL. Do not cache that rejection forever: the next chat
                    // action can load the fresh module after a reload.
                    historyModulePromise = null;
                    throw error;
                }
            );
        }
        return historyModulePromise;
    };

    function isStaleDevModuleError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return /failed to fetch dynamically imported module/i.test(message);
    }
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
        if (historySyncInFlight) {
            historySyncQueued = true;
            logBgStream('history-sync-skip-in-flight', {
                threadId: threadIdRef.value || null,
            });
            return;
        }
        if (threadIdRef.value && historyLoadedFor.value === threadIdRef.value) {
            // History was provided by the parent (or already synced): generation
            // reconciliation still has to run, otherwise a refresh mid-stream
            // leaves the abandoned assistant pending forever.
            await reconcileForegroundGenerations();
            return;
        }
        if (threadIdRef.value && historyLoadedFor.value !== threadIdRef.value) {
            const targetThreadId = threadIdRef.value;
            logBgStream('history-sync-start', {
                threadId: targetThreadId,
                historyLoadedFor: historyLoadedFor.value,
                detached: detached.value,
            });
            historySyncInFlight = true;
            try {
                if (detached.value) detached.value = false;
                const { ensureThreadHistoryLoaded } = await getHistoryModule();
                await ensureThreadHistoryLoaded(
                    threadIdRef,
                    historyLoadedFor,
                    rawMessages
                );
                // A newer navigation owns the reactive state now. The queued
                // sync below will load that target after this stale query ends.
                if (threadIdRef.value !== targetThreadId) return;
                messages.value = rawMessages.value
                    .filter((m: ChatMessage) => m.role !== 'tool')
                    .map((m) => ensureUiMessage(m));
                await reattachBackgroundJobs();
                await reconcileForegroundGenerations();
                logBgStream('history-sync-complete', {
                    threadId: threadIdRef.value,
                    rawCount: rawMessages.value.length,
                    uiCount: messages.value.length,
                    attachedJobs: attachedBackgroundJobs.size,
                });
            } finally {
                historySyncInFlight = false;
                if (historySyncQueued) {
                    historySyncQueued = false;
                    void ensureHistorySynced();
                }
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

    function syncTailAccumulator(
        messageId: string,
        nextContent: string,
        delta: string
    ): boolean {
        if (tailAssistant.value?.id !== messageId) return false;
        if (!nextContent) {
            streamAcc.reset();
            return true;
        }

        const currentContent = streamState.text || '';
        const canAppendDelta =
            delta.length > 0 &&
            nextContent.length === currentContent.length + delta.length &&
            nextContent.startsWith(currentContent);

        if (canAppendDelta) {
            streamAcc.append(delta, { kind: 'text' });
            return true;
        }

        streamAcc.reset();
        streamAcc.append(nextContent, { kind: 'text' });
        return true;
    }

    /**
     * Purpose:
     * Normalizes background tool call payloads into UI-safe tool call state.
     *
     * Behavior:
     * - Converts server `skipped` status into UI `error` for existing indicator states
     * - Preserves args/result/error fields for inline tool details
     */
    function normalizeBackgroundToolCalls(
        calls: BackgroundJobStatus['tool_calls']
    ): ToolCallInfo[] | undefined {
        if (!Array.isArray(calls)) return undefined;
        return calls.map((call) => {
            const mappedStatus =
                call.status === 'skipped' ? 'error' : call.status;
            return {
                id: call.id,
                name: call.name,
                runtime: call.runtime,
                status: mappedStatus,
                args: call.args,
                result: call.result,
                error:
                    mappedStatus === 'error'
                        ? call.error ||
                          `Tool "${call.name}" is not available in background mode.`
                        : call.error,
            };
        });
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
        if (!backgroundJobDisposers.length) {
            logBgStream('clear-bg-subs-skip-none', {
                keepTracking: options?.keepTracking === true,
            });
            return;
        }
        logBgStream('clear-bg-subs-start', {
            keepTracking: options?.keepTracking === true,
            disposerCount: backgroundJobDisposers.length,
            attachedJobs: [...attachedBackgroundJobs],
        });
        for (const jobId of attachedBackgroundJobs) {
            const tracker = backgroundJobTrackers.get(jobId);
            if (tracker && !options?.keepTracking) {
                stopBackgroundJobTracking(tracker);
            }
        }
        for (const dispose of backgroundJobDisposers.splice(
            0,
            backgroundJobDisposers.length
        )) {
            try {
                dispose();
            } catch {
                /* intentionally empty */
            }
        }
        attachedBackgroundJobs.clear();
        logBgStream('clear-bg-subs-complete', {
            keepTracking: options?.keepTracking === true,
        });
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
        /** Workspace database captured before admission; never re-resolved late. */
        originDb?: Or3DB;
        workspaceId?: string;
        canonicalHistory?: boolean;
        generationId?: string;
        initialContent?: string;
        initialReasoning?: string;
        initialAttempt?: number;
        isReattach?: boolean;
        useSse?: boolean;
    }): BackgroundJobTracker {
        logBgStream('attach-bg-job-start', {
            jobId: params.jobId,
            messageId: params.messageId,
            threadId: params.threadId,
            userId: params.userId,
            isReattach: Boolean(params.isReattach),
            useSse: Boolean(params.useSse),
            initialContentLength:
                typeof params.initialContent === 'string'
                    ? params.initialContent.length
                    : 0,
            detached: detached.value,
        });
        const priorTrackerAttempt = backgroundJobTrackers.get(
            params.jobId
        )?.lastAttempt;
        const tracker = ensureBackgroundJobTracker({
            jobId: params.jobId,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
            originDb: params.originDb,
            workspaceId: params.workspaceId,
            canonicalHistory: params.canonicalHistory,
            generationId: params.generationId,
            preferServerNotifications: serverNotificationsEnabled.value,
            // Seed with DB content - server must have MORE to update
            initialContent: params.initialContent,
            initialReasoning: params.initialReasoning,
            initialAttempt: params.initialAttempt,
            useSse: params.useSse,
        });
        if (params.isReattach && typeof params.initialContent === 'string') {
            tracker.lastPersistAt = 0;
            const target = resolveUiMessage(params.messageId);
            if (target) {
                const incomingAttempt = params.initialAttempt;
                const isNewerAttempt =
                    typeof incomingAttempt === 'number' &&
                    typeof priorTrackerAttempt === 'number' &&
                    incomingAttempt > priorTrackerAttempt;
                const isStaleAttempt =
                    typeof incomingAttempt === 'number' &&
                    typeof priorTrackerAttempt === 'number' &&
                    incomingAttempt < priorTrackerAttempt;
                if (
                    !isStaleAttempt &&
                    (isNewerAttempt ||
                        params.initialContent.length > target.text.length)
                ) {
                    target.text = params.initialContent;
                    if (isNewerAttempt) {
                        syncTailAccumulator(
                            params.messageId,
                            params.initialContent,
                            ''
                        );
                    }
                }
                if (
                    typeof params.initialReasoning === 'string' &&
                    params.initialReasoning.length > 0 &&
                    !isStaleAttempt
                ) {
                    target.reasoning_text = params.initialReasoning;
                }
            }
            logBgStream('attach-bg-job-reattach-seed', {
                jobId: params.jobId,
                messageId: params.messageId,
                trackerContentLength: tracker.lastContent.length,
                targetLength:
                    resolveUiMessage(params.messageId)?.text.length ?? 0,
            });
        }
        if (params.isReattach && tailAssistant.value?.id === params.messageId) {
            // Seed stream accumulator with current content
            streamAcc.reset();
            if (
                typeof params.initialContent === 'string' &&
                params.initialContent.length > 0
            ) {
                streamAcc.append(params.initialContent, { kind: 'text' });
            }
            if (
                typeof params.initialReasoning === 'string' &&
                params.initialReasoning.length > 0
            ) {
                streamAcc.append(params.initialReasoning, {
                    kind: 'reasoning',
                });
            }
        }
        const shouldBindUiSubscriber = !detached.value;
        if (
            shouldBindUiSubscriber &&
            !attachedBackgroundJobs.has(params.jobId)
        ) {
            logBgStream('attach-bg-job-bind-subscriber', {
                jobId: params.jobId,
                messageId: params.messageId,
                threadId: params.threadId,
                detached: detached.value,
                attachedAlready: attachedBackgroundJobs.has(params.jobId),
            });
            const subscriber: BackgroundJobSubscriber = {
                onUpdate: ({ content, delta, replace, reasoning, status }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    const previousText = target.text;

                    if (
                        typeof reasoning === 'string' &&
                        reasoning.length > 0 &&
                        reasoning !== target.reasoning_text
                    ) {
                        target.reasoning_text = reasoning;
                    }

                    const nextToolCalls = normalizeBackgroundToolCalls(
                        status.tool_calls
                    );
                    const hasToolUpdate = nextToolCalls !== undefined;
                    if (hasToolUpdate) {
                        target.toolCalls = nextToolCalls;
                    }

                    const currentLen = target.text.length;
                    const contentChanged =
                        content !== target.text &&
                        (replace === true || content.length >= currentLen);

                    if (contentChanged) {
                        target.text = content;
                    }

                    if (
                        target.pending &&
                        (delta || hasToolUpdate || contentChanged)
                    ) {
                        target.pending = false;
                    }

                    if (syncTailAccumulator(params.messageId, content, delta)) {
                        return;
                    } else if (delta || hasToolUpdate || contentChanged) {
                        if (
                            contentChanged &&
                            delta.length > 0 &&
                            content.length ===
                                previousText.length + delta.length &&
                            content.startsWith(previousText)
                        ) {
                            return;
                        }
                        messages.value = [...messages.value];
                    }
                },
                onComplete: ({ content, reasoning, status }) => {
                    if (detached.value) {
                        logBgStream(
                            'attach-bg-job-on-complete-skipped-detached',
                            {
                                jobId: params.jobId,
                                messageId: params.messageId,
                            }
                        );
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    logBgStream('attach-bg-job-on-complete', {
                        jobId: params.jobId,
                        messageId: params.messageId,
                        status: status.status,
                        contentLength: content.length,
                        toolCalls: Array.isArray(status.tool_calls)
                            ? status.tool_calls.length
                            : 0,
                    });
                    target.text = content;
                    if (typeof reasoning === 'string' && reasoning.length > 0) {
                        target.reasoning_text = reasoning;
                    }
                    const nextToolCalls = normalizeBackgroundToolCalls(
                        status.tool_calls
                    );
                    if (nextToolCalls) {
                        target.toolCalls = nextToolCalls;
                    }
                    target.pending = false;
                    if (
                        syncTailAccumulator(params.messageId, content, content)
                    ) {
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
                onError: ({ reasoning, status }) => {
                    if (detached.value) {
                        logBgStream('attach-bg-job-on-error-skipped-detached', {
                            jobId: params.jobId,
                            messageId: params.messageId,
                        });
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    if (typeof reasoning === 'string' && reasoning.length > 0) {
                        target.reasoning_text = reasoning;
                    }
                    logBgStream('attach-bg-job-on-error', {
                        jobId: params.jobId,
                        messageId: params.messageId,
                        status: status.status,
                        error: status.error || null,
                    });
                    const nextToolCalls = normalizeBackgroundToolCalls(
                        status.tool_calls
                    );
                    if (nextToolCalls) {
                        target.toolCalls = nextToolCalls;
                    }
                    target.pending = false;
                    target.error = status.error || 'Background response failed';
                    if (tailAssistant.value?.id !== params.messageId) {
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({
                        error: new Error(
                            target.error || 'Background response failed'
                        ),
                    });
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
                onAbort: ({ reasoning, status }) => {
                    if (detached.value) {
                        logBgStream('attach-bg-job-on-abort-skipped-detached', {
                            jobId: params.jobId,
                            messageId: params.messageId,
                        });
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    if (typeof reasoning === 'string' && reasoning.length > 0) {
                        target.reasoning_text = reasoning;
                    }
                    logBgStream('attach-bg-job-on-abort', {
                        jobId: params.jobId,
                        messageId: params.messageId,
                        status: status.status,
                    });
                    const nextToolCalls = normalizeBackgroundToolCalls(
                        status.tool_calls
                    );
                    if (nextToolCalls) {
                        target.toolCalls = nextToolCalls;
                    }
                    target.pending = false;
                    target.error = 'stopped';
                    if (tailAssistant.value?.id !== params.messageId) {
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({ aborted: true });
                    void updateMessageRecord(
                        tracker.originDb ?? getDb(),
                        params.messageId,
                        {
                            pending: false,
                            error: 'stopped',
                        }
                    );
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
                onTransportError: ({ status }) => {
                    logBgStream('attach-bg-job-on-transport-error', {
                        jobId: params.jobId,
                        messageId: params.messageId,
                        kind: status.trackingInterruptedKind ?? 'unknown',
                        detached: detached.value,
                    });
                    // Connection/protocol/auth problems are not generation
                    // failures. Only project the durable interrupted state when
                    // the server job was confirmed missing; otherwise leave the
                    // row pending so reattachment can retry.
                    if (
                        !detached.value &&
                        status.trackingInterruptedKind === 'missing'
                    ) {
                        const target = resolveUiMessage(params.messageId);
                        if (target) {
                            target.pending = false;
                            target.error = 'stream_interrupted';
                            messages.value = [...messages.value];
                        }
                    }
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
            logBgStream('attach-bg-job-subscriber-registered', {
                jobId: params.jobId,
                attachedCount: attachedBackgroundJobs.size,
                disposerCount: backgroundJobDisposers.length,
                trackerStatus: tracker.status,
                trackerPolling: tracker.polling,
                trackerStreaming: tracker.streaming,
            });
            if (params.isReattach && !tracker.polling && !tracker.streaming) {
                // Only prime if polling hasn't started yet
                logBgStream('attach-bg-job-prime-triggered', {
                    jobId: params.jobId,
                });
                void primeBackgroundJobUpdate(tracker);
            }
            // If polling is already running, resetting tracker.lastContent = ''
            // will cause next poll to fetch full content automatically
        } else {
            logBgStream('attach-bg-job-subscriber-not-bound', {
                jobId: params.jobId,
                shouldBindUiSubscriber,
                alreadyAttached: attachedBackgroundJobs.has(params.jobId),
                detached: detached.value,
            });
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
    const reconcileTimersScheduled = new Set<string>();
    async function reconcileForegroundGenerations(): Promise<void> {
        const reconcileThreadId = threadIdRef.value;
        if (!reconcileThreadId) return;
        // Capture the workspace at admission: recovery must finalize rows in
        // the thread's own database even if the user navigates mid-reconcile.
        const reconcileDb = getDb();
        const persisted = (await messagesByThread(reconcileThreadId)) as
            | StoredMessage[]
            | undefined;
        // Stale query results must never touch a newer thread's view.
        if (threadIdRef.value !== reconcileThreadId) return;
        for (const row of persisted ?? []) {
            const rowData = row.data as Record<string, unknown> | null;
            if (
                row.role !== 'assistant' ||
                row.pending !== true ||
                typeof rowData?.background_job_id === 'string'
            )
                continue;

            const interrupt = async () => {
                reconcileTimersScheduled.delete(row.id);
                const latest = (await reconcileDb.messages.get(row.id)) as
                    | StoredMessage
                    | undefined;
                if (!latest) return;
                let finalizedHere = false;
                if (isStaleForegroundGeneration(latest)) {
                    await updateMessageRecord(
                        reconcileDb,
                        row.id,
                        {
                            pending: false,
                            error: 'stream_interrupted',
                            data: { generation_state: 'interrupted' },
                        },
                        latest
                    );
                    finalizedHere = true;
                }
                // Only mutate the live view while it still shows this thread.
                // Project the durable terminal state even when a concurrent
                // recovery already finalized the row, so an older pending
                // projection (e.g. seeded history) never strands the UI.
                if (threadIdRef.value !== reconcileThreadId) return;
                const terminalError =
                    latest.error ??
                    (finalizedHere ? 'stream_interrupted' : undefined);
                if (terminalError === undefined) return;
                // finalizedHere means the durable row just left pending behind;
                // otherwise mirror the durable row's own pending flag.
                const leftPending = !finalizedHere && latest.pending === true;
                const raw = rawMessages.value.find(
                    (message) => message.id === row.id
                );
                if (raw) {
                    raw.error = terminalError;
                    if (!leftPending) raw.pending = false;
                }
                const ui = messages.value.find(
                    (message) => message.id === row.id
                );
                if (ui) {
                    if (!leftPending) ui.pending = false;
                    ui.error = terminalError;
                }
            };

            const remaining = remainingForegroundLeaseMs(row);
            if (remaining === 0 || isStaleForegroundGeneration(row)) {
                await interrupt();
                if (threadIdRef.value !== reconcileThreadId) return;
            } else if (!reconcileTimersScheduled.has(row.id)) {
                reconcileTimersScheduled.add(row.id);
                const timer = setTimeout(() => void interrupt(), remaining);
                cleanupFns.push(() => clearTimeout(timer));
            }
        }
    }

    async function reattachBackgroundJobs(): Promise<void> {
        if (!backgroundStreamingAllowed.value || !threadIdRef.value) {
            logBgStream('reattach-skip-disabled-or-missing-thread', {
                threadId: threadIdRef.value || null,
                backgroundStreamingAllowed: backgroundStreamingAllowed.value,
            });
            return;
        }
        // Capture navigation ownership before the first await. The query and
        // every attachment below must target the thread/workspace that was
        // current when reattachment started, not whatever is current after an
        // await resolves.
        const reattachThreadId = threadIdRef.value;
        const reattachDb = getDb();
        const reattachWorkspaceId = getActiveWorkspaceId() ?? 'local';
        const reattachRevision = navigationRevision;
        const ownsReattach = () =>
            navigationRevision === reattachRevision &&
            threadIdRef.value === reattachThreadId;
        logBgStream('reattach-start', {
            threadId: reattachThreadId,
            workspaceId: reattachWorkspaceId,
            revision: reattachRevision,
            detached: detached.value,
            activeBackgroundJobId: backgroundJobId.value,
        });

        try {
            const dbMessages = (await messagesByThread(
                reattachThreadId,
                reattachDb
            )) as StoredMessage[] | undefined;
            if (!ownsReattach()) {
                logBgStream('reattach-abandoned-stale-navigation', {
                    threadId: reattachThreadId,
                    revision: reattachRevision,
                });
                return;
            }
            const list = Array.isArray(dbMessages) ? dbMessages : [];
            logBgStream('reattach-scan', {
                threadId: reattachThreadId,
                messageCount: list.length,
            });
            for (const msg of list) {
                if (msg.role !== 'assistant' || !msg.pending || !msg.data)
                    continue;
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
                if (!ownsReattach()) {
                    logBgStream('reattach-abandoned-stale-navigation', {
                        threadId: reattachThreadId,
                        revision: reattachRevision,
                    });
                    return;
                }

                const initialContent =
                    typeof data.content === 'string'
                        ? data.content
                        : typeof msg.content === 'string'
                          ? msg.content
                          : '';
                const initialReasoning =
                    typeof data.reasoning_text === 'string'
                        ? data.reasoning_text
                        : '';

                attachBackgroundJobToUi({
                    jobId,
                    userId: notificationUserId.value,
                    messageId: msg.id,
                    threadId: reattachThreadId,
                    originDb: reattachDb,
                    workspaceId: reattachWorkspaceId,
                    canonicalHistory: data.background_history_version === 1,
                    generationId:
                        typeof data.generation_id === 'string'
                            ? data.generation_id
                            : undefined,
                    initialContent,
                    initialReasoning,
                    initialAttempt:
                        typeof data.background_job_attempt === 'number'
                            ? data.background_job_attempt
                            : undefined,
                    isReattach: true,
                    useSse: backgroundStreamingAllowed.value,
                });
                logBgStream('reattach-job-bound', {
                    threadId: reattachThreadId,
                    messageId: msg.id,
                    jobId,
                    status,
                    initialContentLength: initialContent.length,
                });

                if (!ownsReattach()) return;
                if (!backgroundJobId.value) {
                    backgroundJobId.value = jobId;
                    backgroundJobInfo.value = {
                        jobId,
                        threadId: reattachThreadId,
                        messageId: msg.id,
                    };
                }
                if (backgroundJobMode.value === 'none') {
                    backgroundJobMode.value = 'background';
                }
            }
            if (!ownsReattach()) return;
            logBgStream('reattach-complete', {
                threadId: reattachThreadId,
                attachedJobs: attachedBackgroundJobs.size,
                backgroundJobId: backgroundJobId.value,
                backgroundJobMode: backgroundJobMode.value,
            });
        } catch (error) {
            warnBgStream('reattach-failed', {
                threadId: reattachThreadId,
                error: error instanceof Error ? error.message : String(error),
            });
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
    ): Promise<SendResult> {
        if (activeRequestId) return { status: 'rejected', reason: 'busy' };
        const requestId = newId();
        let resolveSettled!: () => void;
        const requestScope: ChatRequestScope = {
            requestId,
            originDb: getDb(),
            workspaceId: getActiveWorkspaceId() ?? 'local',
            accumulator: streamAcc,
            threadId: threadIdRef.value,
            cancelled: false,
            settled: new Promise<void>((resolve) => {
                resolveSettled = resolve;
            }),
            resolveSettled,
            abortController: null,
            toolLedger: new Map(),
        };
        activeRequestId = requestId;
        activeRequestScope = requestScope;
        requestScope.accumulator.reset();
        loading.value = true;
        requestState.value = { status: 'admitted', requestId };
        let result: SendResult = {
            status: 'failed',
            requestId,
            reason: 'stream_error',
            error: 'Chat request ended before returning a terminal result.',
        };
        try {
            result = await executeSendMessage(
                requestScope,
                contentOrParams,
                maybeParams
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            result = {
                status: 'failed',
                requestId,
                reason:
                    error instanceof ToolIterationLimitError
                        ? 'tool_iteration_limit'
                        : 'stream_error',
                error: message,
            };
            if (import.meta.dev) {
                console.warn('[useChat] sendMessage threw', error);
            }
            reportError(
                err('ERR_INTERNAL', message || 'Failed to send message', {
                    severity: 'error',
                    tags: { domain: 'chat', stage: 'send' },
                }),
                { toast: true }
            );
        } finally {
            if (activeRequestId === requestId) activeRequestId = null;
            if (activeRequestScope === requestScope) {
                activeRequestScope = null;
                abortController.value = null;
                loading.value = false;
                requestState.value = { status: 'terminal', requestId, result };
            }
            requestScope.resolveSettled();
            if (
                result.status !== 'detached' &&
                requestScope.workflowMessageId
            ) {
                workflowMessageScopes.delete(requestScope.workflowMessageId);
            }
        }
        return result;
    }

    async function executeSendMessage(
        requestScope: ChatRequestScope,
        contentOrParams: string | (SendMessageParams & { content: string }),
        maybeParams?: SendMessageParams
    ): Promise<SendResult> {
        const requestId = requestScope.requestId;
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

        const hasKey = Boolean(effectiveApiKey.value) || hasInstanceKey.value;
        if (!hasKey) {
            if (allowUserOverride.value && guestAccessEnabled.value) {
                // Guest access enabled - trigger OpenRouter login
                void openRouterAuth.startLogin();
            } else if (!allowUserOverride.value) {
                toast.add({
                    title: 'Instance key required',
                    description:
                        'This deployment requires a managed OpenRouter key. Contact your administrator.',
                    color: 'warning',
                    duration: 4000,
                });
            } else if (runtimeConfig.public.ssrAuthEnabled === true) {
                // SSR mode: user must authenticate via the auth provider first
                toast.add({
                    title: 'Sign in required',
                    description: 'Please sign in to continue chatting.',
                    color: 'info',
                    duration: 4000,
                });
            } else {
                // Static/local mode: there is no "sign in" — the user just
                // needs an OpenRouter key. The chat input already shows
                // connect/paste actions; this is only a backstop.
                toast.add({
                    title: 'Connect to OpenRouter',
                    description: 'Add an OpenRouter API key to start chatting.',
                    color: 'info',
                    duration: 4000,
                });
            }
            return {
                status: 'rejected',
                requestId,
                reason: 'missing_credentials',
            };
        }

        // Extract extra text parts early so we can account for them in validation.
        // Large pastes (>600 words) are captured into extraTextParts while the
        // editor text field (content) is left empty — the send button and model
        // must still accept the message.
        const earlyExtraTextParts: string[] = Array.isArray(
            sendMessagesParams.extraTextParts
        )
            ? sendMessagesParams.extraTextParts.filter(
                  (t): t is string => typeof t === 'string' && t.trim() !== ''
              )
            : [];

        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        if (
            (!outgoing ||
                typeof outgoing !== 'string' ||
                outgoing.trim() === '') &&
            earlyExtraTextParts.length === 0
        ) {
            toast.add({
                title: 'Message blocked',
                description: 'Your message was filtered out.',
                duration: 3000,
            });
            return { status: 'rejected', requestId, reason: 'filtered' };
        }

        // Navigation can happen while an async outgoing filter is running. Do
        // not let that older admission create messages in the newly selected
        // thread after it resumes.
        if (
            requestScope.cancelled ||
            (requestScope.threadId &&
                threadIdRef.value !== requestScope.threadId)
        ) {
            return { status: 'aborted', requestId, reason: 'aborted' };
        }

        const canSend = await enforceClientLimits(!requestScope.threadId);
        if (!canSend)
            return { status: 'rejected', requestId, reason: 'client_limit' };

        if (!requestScope.threadId) {
            const effectivePromptId =
                pendingPromptIdRef.value || DEFAULT_PROMPT_SELECTION;
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
                        toast.add({
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
            const newThread = await createThreadInDb(
                requestScope.originDb,
                {
                    title:
                        content.split(' ').slice(0, 6).join(' ') ||
                        'New Thread',
                    last_message_at: nowSec(),
                    parent_thread_id: null,
                    system_prompt_id: effectivePromptId || null,
                },
                {
                    hooks,
                    limits: runtimeConfig.public.limits,
                }
            );
            if (requestScope.cancelled) {
                return { status: 'aborted', requestId, reason: 'aborted' };
            }
            requestScope.threadId = newThread.id;
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

        const requestThreadId = requestScope.threadId;
        if (!requestThreadId) {
            return {
                status: 'failed',
                requestId,
                reason: 'stream_error',
                error: 'No chat thread is available for this request.',
            };
        }

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

        requestScope.accumulator.reset();
        let { files, model, file_hashes } = sendMessagesParams;
        const {
            extraTextParts,
            online,
            modelVariant,
            thinking,
            reasoningEffort,
            context_hashes,
        } = sendMessagesParams;
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
        const originalModelId = model;
        const normalizedModelId = stripThinkingSuffix(originalModelId);
        const { catalog, favoriteModels } = useModelStore();
        const modelMeta =
            catalog.value.find((m: ModelInfo) => m.id === normalizedModelId) ||
            favoriteModels.value.find(
                (m: ModelInfo) => m.id === normalizedModelId
            );
        const requestedThinking =
            thinking === true || originalModelId.endsWith(THINKING_SUFFIX);
        const reasoning = requestedThinking
            ? resolveReasoningConfig({
                  model: modelMeta,
                  enabled: true,
                  effort: reasoningEffort,
              })
            : undefined;
        model = normalizedModelId;
        model = appendModelVariant(
            model,
            modelVariant ?? (online === true ? 'online' : 'off')
        );

        file_hashes = mergeAssistantFileHashes(assistantHashes, file_hashes);

        // Verify files exist (no Base64 conversion - that happens in buildOpenRouterMessages)
        const hydratedFiles = await Promise.all(
            Array.isArray(files) ? files.map(normalizeFileUrl) : []
        );
        if (requestScope.cancelled || threadIdRef.value !== requestThreadId) {
            return { status: 'aborted', requestId, reason: 'aborted' };
        }

        const parts: ContentPart[] = buildParts(
            outgoing,
            hydratedFiles,
            extraTextParts
        );
        // Persist the full user-visible text so reloads and retries keep pasted
        // large-text blocks. The in-flight model input still uses `parts` so
        // image/file parts are preserved for this request.
        const persistedUserText = [outgoing, ...(extraTextParts ?? [])]
            .filter(
                (t): t is string => typeof t === 'string' && t.trim() !== ''
            )
            .join('\n\n');
        const nextUserMessageId = newId();
        const userDbMsg = await appendMessageToDb(requestScope.originDb, {
            id: nextUserMessageId,
            thread_id: requestThreadId,
            role: 'user',
            data: {
                ...userTranscriptData(nextUserMessageId),
                content: persistedUserText,
                attachments: files ?? [],
            },
            file_hashes: file_hashes.length
                ? serializeFileHashes(file_hashes)
                : undefined,
        });
        requestState.value = {
            status: 'persisted',
            requestId,
            userMessageId: userDbMsg.id,
        };
        const rawUser: ChatMessage = {
            role: 'user',
            content: parts,
            id: userDbMsg.id,
            file_hashes: userDbMsg.file_hashes,
        };
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
                        threadId: requestThreadId,
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
        requestScope.streamId = undefined;
        streamId.value = undefined;
        backgroundJobId.value = null;
        detached.value = false;

        let currentModelId: string | undefined;
        let terminalResult: SendResult | undefined;
        try {
            const startedAt = Date.now();
            const modelIdPromise = hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );
            const historySyncPromise = ensureHistorySynced();

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
            const systemMessagePromise = buildSystemPromptMessage({
                threadId: requestThreadId,
                activePromptContent: activePromptContent.value,
                masterPrompt,
            });
            const [modelId] = await Promise.all([
                modelIdPromise,
                historySyncPromise,
            ]);
            currentModelId = modelId;
            const systemMessage = await systemMessagePromise;
            if (
                requestScope.cancelled ||
                threadIdRef.value !== requestThreadId
            ) {
                return {
                    status: 'aborted',
                    requestId,
                    reason: 'aborted',
                    userMessageId: userDbMsg.id,
                };
            }

            const messagesWithSystemRaw = sendMessagesParams.historyOverride
                ? [...sendMessagesParams.historyOverride, rawUser]
                : [...rawMessages.value];
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

            const budgetModelId = stripModelVariantSuffix(
                stripThinkingSuffix(modelId)
            );
            const budgetModelMeta =
                catalog.value.find(
                    (candidate: ModelInfo) => candidate.id === budgetModelId
                ) ||
                favoriteModels.value.find(
                    (candidate: ModelInfo) => candidate.id === budgetModelId
                ) ||
                modelMeta;
            const maxInputTokens = resolveChatInputTokenBudget(budgetModelMeta);

            let orMessages = await buildOpenRouterMessagesForSend({
                effectiveMessages: sanitizedEffectiveMessages,
                assistantHashes,
                prevAssistantId: prevAssistant?.id,
                contextHashes: context_hashes,
                fileHashes: Array.isArray(file_hashes) ? file_hashes : [],
                maxImageInputs: 5,
                imageInclusionPolicy: 'all',
                maxInputTokens,
            });
            if (
                requestScope.cancelled ||
                threadIdRef.value !== requestThreadId
            ) {
                return {
                    status: 'aborted',
                    requestId,
                    reason: 'aborted',
                    userMessageId: userDbMsg.id,
                };
            }
            if (orMessages.length === 0) {
                return {
                    status: 'failed',
                    requestId,
                    reason: 'empty_context',
                    error: 'No model input remained after message preparation.',
                    userMessageId: userDbMsg.id,
                };
            }

            // modalities controls OUTPUT format, not input capability
            const modalities = getChatModalities(modelId);

            const newStreamId = newId();
            requestScope.streamId = newStreamId;
            streamId.value = newStreamId;
            const nextAssistantId = newId();
            const assistantDbMsg = (await appendMessageToDb(
                requestScope.originDb,
                {
                    id: nextAssistantId,
                    thread_id: requestThreadId,
                    role: 'assistant',
                    stream_id: newStreamId,
                    pending: true, // Mark as streaming - HookBridge will skip sync until finalized
                    data: {
                        ...assistantTranscriptData({
                            turnId: userDbMsg.id,
                            requestId,
                            generationId: newStreamId,
                            mode: 'foreground',
                        }),
                        content: '',
                        attachments: [],
                        reasoning_text: null,
                        generation_state: 'streaming',
                        ...createForegroundGenerationLease(requestId),
                    },
                }
            )) as StoredMessage;
            requestScope.assistantMessageId = assistantDbMsg.id;
            requestState.value = {
                status: 'streaming',
                requestId,
                userMessageId: userDbMsg.id,
                assistantMessageId: assistantDbMsg.id,
            };
            // Track file hashes across loop iterations
            const assistantFileHashes: string[] = [];
            const persistAssistant = makeAssistantPersister(
                requestScope.originDb,
                assistantDbMsg,
                assistantFileHashes,
                requestId
            );
            requestScope.persistAssistant = persistAssistant;

            // Workflow execution returns control to the caller immediately,
            // so retain the request's DB/thread authority after sendMessage
            // detaches and clears activeRequestScope.
            workflowMessageScopes.set(assistantDbMsg.id, {
                originDb: requestScope.originDb,
                workspaceId: requestScope.workspaceId,
                threadId: requestThreadId,
            });
            requestScope.workflowMessageId = assistantDbMsg.id;

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: requestThreadId,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? effectiveMessages.length
                    : undefined,
            });

            const toolRegistry = useToolRegistry();
            const enabledToolDefs = toolRegistry.getEnabledDefinitions({
                workspaceId: requestScope.workspaceId,
                threadId: requestThreadId,
            });
            const foregroundToolDefs = enabledToolDefs.filter(
                (tool) => tool.runtime !== 'server'
            );

            // Track tool calls across all loop iterations (persists state)
            const activeToolCalls = new Map<string, ToolCallInfo>();

            aborted.value = false;
            requestScope.abortController = null;
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
            orMessages = await enforceOpenRouterMessageTokenBudget(
                orMessages,
                maxInputTokens
            );

            // Check if a workflow is handling this request - skip AI call
            if (consumeChatSendHandled()) {
                // Seed UI with assistant placeholder so workflow state can render immediately
                const workflowAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };
                rawMessages.value.push(workflowAssistant);
                const uiAssistant = ensureUiMessage(workflowAssistant);
                uiAssistant.pending = true;
                messages.value.push(uiAssistant);
                loading.value = false;
                requestScope.abortController = null;
                abortController.value = null;
                return {
                    status: 'detached',
                    requestId,
                    reason: 'detached',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }

            // This request is going through the regular model path; there is
            // no detached workflow completion that needs the retained scope.
            workflowMessageScopes.delete(assistantDbMsg.id);

            // Also skip if messages array is empty (e.g., workflow returned empty)
            if (orMessages.length === 0) {
                const emptyContextError =
                    'No model input remained after request filters.';
                const failedAssistant = resolveUiMessage(assistantDbMsg.id);
                if (failedAssistant) {
                    failedAssistant.pending = false;
                    failedAssistant.error = 'empty_context';
                    messages.value = [...messages.value];
                }

                // The assistant placeholder was persisted before the final
                // before_send hook ran. Finalize it here so a filter that
                // removes every provider message cannot strand a pending row.
                // Keep the user message and the failed assistant record in
                // history; this makes the terminal outcome visible after a
                // reload and preserves retry/branching invariants.
                let finalizationError: unknown = null;
                try {
                    await persistAssistant({
                        content: failedAssistant?.text ?? '',
                        reasoning: failedAssistant?.reasoning_text ?? null,
                        toolCalls: failedAssistant?.toolCalls ?? null,
                        finalize: true,
                    });
                } catch (error) {
                    finalizationError = error;
                }
                try {
                    await updateMessageRecord(
                        requestScope.originDb,
                        assistantDbMsg.id,
                        {
                            pending: false,
                            error: 'empty_context',
                            data: {
                                content: failedAssistant?.text ?? '',
                                reasoning_text:
                                    failedAssistant?.reasoning_text ?? null,
                                generation_state: 'error',
                                error: 'empty_context',
                            },
                        },
                        assistantDbMsg
                    );
                } catch (error) {
                    finalizationError ??= error;
                }
                if (finalizationError) {
                    reportError(
                        err(
                            'ERR_DB_WRITE_FAILED',
                            'Failed to finalize the filtered assistant message.',
                            {
                                cause: finalizationError,
                                tags: {
                                    domain: 'chat',
                                    threadId: requestThreadId,
                                    messageId: assistantDbMsg.id,
                                    stage: 'before_send_filter',
                                },
                            }
                        ),
                        { silent: true }
                    );
                }
                requestScope.accumulator.finalize({
                    error: new Error(emptyContextError),
                });
                toast.add({
                    title: 'Message not sent',
                    description:
                        'A message filter removed all model input. Nothing was sent.',
                    color: 'warning',
                    duration: 3500,
                });
                reportError(
                    err('ERR_HOOK_FAILURE', emptyContextError, {
                        severity: 'info',
                        tags: {
                            domain: 'chat',
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                            stage: 'before_send_filter',
                        },
                    }),
                    { toast: false }
                );
                loading.value = false;
                return {
                    status: 'failed',
                    requestId,
                    reason: 'empty_context',
                    error: emptyContextError,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }

            const hasBrowserTools = enabledToolDefs.some(
                (tool) => tool.runtime === 'client'
            );
            const browserToolBridgeAvailable =
                !hasBrowserTools ||
                !backgroundStreamingAllowed.value ||
                await isBackgroundClientToolBridgeAvailable();
            const allowBackgroundStreaming =
                backgroundStreamingAllowed.value &&
                browserToolBridgeAvailable &&
                modalities.length === 1 &&
                modalities[0] === 'text';
            logBgStream('send-message-stream-mode-decision', {
                threadId: requestThreadId,
                allowBackgroundStreaming,
                backgroundStreamingAllowed: backgroundStreamingAllowed.value,
                enabledToolCount: enabledToolDefs.length,
                modalities,
            });

            if (allowBackgroundStreaming) {
                backgroundJobMode.value = 'background';
                logBgStream('send-message-background-start', {
                    threadId: requestThreadId,
                    messageId: assistantDbMsg.id,
                    streamId: newStreamId,
                });

                const rawAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };

                rawMessages.value.push(rawAssistant);
                const uiAssistant = ensureUiMessage(rawAssistant);
                uiAssistant.pending = true;
                tailAssistant.value = uiAssistant;

                // Background admission can block before a job ID exists. Keep it
                // cancellable through the same request-scoped controller as foreground.
                requestScope.abortController = new AbortController();
                abortController.value = requestScope.abortController;

                // Stable per-send admission identity. Persisted on the request
                // scope before the start request so Stop can target the
                // admission even before a job ID returns.
                const backgroundAdmissionId = newId();
                requestScope.backgroundAdmissionId = backgroundAdmissionId;

                try {
                    const toolRuntime =
                        enabledToolDefs.length > 0
                            ? enabledToolDefs.reduce<Record<string, string>>(
                                  (acc, tool) => {
                                      if (tool.runtime) {
                                          acc[tool.function.name] =
                                              tool.runtime;
                                      }
                                      return acc;
                                  },
                                  {}
                              )
                            : undefined;

                    // Capture the exact local records before paid execution.
                    // The assistant stays pending locally (so HookBridge does
                    // not race it); the server commits this envelope directly
                    // to canonical sync history before claiming the job.
                    await updateMessageRecord(
                        requestScope.originDb,
                        assistantDbMsg.id,
                        {
                            data: {
                                background_admission_id: backgroundAdmissionId,
                                generation_mode: 'background',
                                generation_state: 'streaming',
                                background_history_version: 1,
                            },
                        }
                    );
                    const [historyThread, historyAssistant] = await Promise.all(
                        [
                            requestScope.originDb.threads.get(requestThreadId),
                            requestScope.originDb.messages.get(
                                assistantDbMsg.id
                            ),
                        ]
                    );
                    if (!historyThread || !historyAssistant) {
                        throw new Error(
                            'Unable to capture canonical background history'
                        );
                    }

                    const result = await startBackgroundStream({
                        apiKey: effectiveApiKey.value,
                        model: modelId,
                        orMessages: orMessages as Parameters<
                            typeof startBackgroundStream
                        >[0]['orMessages'],
                        modalities,
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                        admissionId: backgroundAdmissionId,
                        history: {
                            version: 1,
                            kind: 'new-turn',
                            admissionId: backgroundAdmissionId,
                            generationId: newStreamId,
                            workspaceId: requestScope.workspaceId,
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                            thread: historyThread,
                            userMessage: userDbMsg,
                            assistantMessage: historyAssistant,
                        },
                        reasoning,
                        tools:
                            enabledToolDefs.length > 0
                                ? enabledToolDefs
                                : undefined,
                        toolRuntime,
                        signal: requestScope.abortController.signal,
                    });

                    logBgStream('send-message-background-job-created', {
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                        streamId: newStreamId,
                        jobId: result.jobId,
                    });

                    if (
                        assistantDbMsg.data &&
                        typeof assistantDbMsg.data === 'object'
                    ) {
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
                    await projectCanonicalBackgroundMessage(
                        requestScope.originDb,
                        assistantDbMsg.id,
                        {
                            data: {
                                background_job_id: result.jobId,
                                background_admission_id: backgroundAdmissionId,
                                background_job_status: 'streaming',
                                generation_mode: 'background',
                                generation_state: 'streaming',
                            },
                        }
                    );

                    const ownsCurrentThread = ownsCurrentView(requestScope);
                    if (ownsCurrentThread) {
                        backgroundJobId.value = result.jobId;
                        backgroundJobInfo.value = {
                            jobId: result.jobId,
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                        };
                    }
                    const tracker = ownsCurrentThread
                        ? attachBackgroundJobToUi({
                              jobId: result.jobId,
                              userId: notificationUserId.value,
                              messageId: assistantDbMsg.id,
                              threadId: requestThreadId,
                              originDb: requestScope.originDb,
                              workspaceId: requestScope.workspaceId,
                              canonicalHistory: true,
                              generationId: newStreamId,
                              initialContent: '',
                              useSse: backgroundStreamingAllowed.value,
                          })
                        : ensureBackgroundJobTracker({
                              jobId: result.jobId,
                              userId: notificationUserId.value,
                              messageId: assistantDbMsg.id,
                              threadId: requestThreadId,
                              originDb: requestScope.originDb,
                              workspaceId: requestScope.workspaceId,
                              canonicalHistory: true,
                              generationId: newStreamId,
                              preferServerNotifications:
                                  serverNotificationsEnabled.value,
                              initialContent: '',
                              useSse: false,
                          });

                    logBgStream('send-message-background-await-completion', {
                        jobId: tracker.jobId,
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                    });
                    const completion = await tracker.completion;
                    logBgStream('send-message-background-completed', {
                        jobId: tracker.jobId,
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                    });
                    if (completion.status === 'aborted') {
                        return {
                            status: 'aborted',
                            requestId,
                            reason: 'aborted',
                            userMessageId: userDbMsg.id,
                            assistantMessageId: assistantDbMsg.id,
                        };
                    }
                    if (completion.status === 'error') {
                        return {
                            status: 'failed',
                            requestId,
                            reason: 'stream_error',
                            error:
                                completion.error || 'Background stream failed',
                            userMessageId: userDbMsg.id,
                            assistantMessageId: assistantDbMsg.id,
                        };
                    }
                } catch (error) {
                    if (
                        aborted.value ||
                        requestScope.abortController?.signal.aborted ||
                        (error instanceof Error && error.name === 'AbortError')
                    ) {
                        // Let the request-level abort path own cleanup and the
                        // terminal result. Treating admission cancellation as a
                        // provider failure leaves a false error row behind.
                        throw error;
                    }
                    const errMessage =
                        error instanceof Error
                            ? error.message
                            : 'Background stream failed';
                    // This admission may have been superseded by navigation. Its
                    // durable row still belongs to the origin DB, but no shared
                    // UI state (tail, loading, background controls, accumulator)
                    // may be touched once it no longer owns the visible view.
                    const ownsView = ownsCurrentView(requestScope);
                    warnBgStream('send-message-background-failed', {
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                        error: errMessage,
                        ownsCurrentView: ownsView,
                    });
                    const target = ownsView
                        ? resolveUiMessage(assistantDbMsg.id)
                        : undefined;
                    if (ownsView && target) {
                        target.pending = false;
                        target.error = errMessage;
                        messages.value = [...messages.value];
                    }
                    try {
                        await persistAssistant({
                            content: target?.text ?? '',
                            reasoning: target?.reasoning_text ?? null,
                            toolCalls: target?.toolCalls ?? null,
                            finalize: true,
                            terminalState: 'failed',
                        });
                        await updateMessageRecord(
                            requestScope.originDb,
                            assistantDbMsg.id,
                            {
                                pending: false,
                                error: errMessage,
                                data: {
                                    background_job_status: 'error',
                                    background_job_error: errMessage,
                                    error: errMessage,
                                },
                            }
                        );
                    } catch (persistError) {
                        warnBgStream('background-start-finalize-failed', {
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                            error:
                                persistError instanceof Error
                                    ? persistError.message
                                    : String(persistError),
                        });
                    }
                    if (ownsView) {
                        requestScope.accumulator.finalize({
                            error: new Error(errMessage),
                        });
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                    return {
                        status: 'failed',
                        requestId,
                        reason: 'stream_error',
                        error: errMessage,
                        userMessageId: userDbMsg.id,
                        assistantMessageId: assistantDbMsg.id,
                    };
                }

                return {
                    status: 'complete',
                    requestId,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }

            requestScope.abortController = new AbortController();
            abortController.value = requestScope.abortController;

            await runForegroundStreamLoop({
                apiKey: effectiveApiKey.value,
                modelId,
                orMessages,
                modalities,
                reasoning,
                tools:
                    foregroundToolDefs.length > 0
                        ? foregroundToolDefs
                        : undefined,
                abortSignal: requestScope.abortController.signal,
                assistantId: assistantDbMsg.id,
                parentTurnId: userDbMsg.id,
                streamId: newStreamId,
                threadId: requestThreadId,
                originDb: requestScope.originDb,
                streamAcc: requestScope.accumulator,
                workspaceId: requestScope.workspaceId,
                hooks,
                toolRegistry,
                persistAssistant,
                assistantFileHashes,
                activeToolCalls,
                tailAssistant,
                rawMessages,
                toolLedger: requestScope.toolLedger,
                outputLimitBytes: canonicalOutputLimitBytes,
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
            // Write the finished turn (assistant + tool rows) back into the
            // canonical history. Without this, rawMessages keeps the empty
            // placeholder and the next request loses the answer and tools.
            try {
                await reloadTurnIntoRawMessages(
                    requestScope.originDb,
                    requestThreadId,
                    assistantDbMsg.id,
                    rawMessages,
                    threadIdRef
                );
            } catch (writebackError) {
                if (import.meta.dev) {
                    console.warn(
                        '[useChat] turn writeback failed',
                        writebackError
                    );
                }
            }
            const finalized: StoredMessage = {
                ...assistantDbMsg,
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : assistantDbMsg.file_hashes,
            };
            await hooks.doAction('ai.chat.stream:action:complete', {
                threadId: requestThreadId,
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
                            threadId: requestThreadId,
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
                threadId: requestThreadId,
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
            requestScope.accumulator.finalize();
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;
            terminalResult = {
                status: 'complete',
                requestId,
                userMessageId: userDbMsg.id,
                assistantMessageId: assistantDbMsg.id,
            };
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                if (isDetached()) {
                    return {
                        status: 'detached',
                        requestId,
                        reason: 'detached',
                        userMessageId: userDbMsg.id,
                    };
                }
            }
            if (
                aborted.value ||
                requestScope.abortController?.signal.aborted === true
            ) {
                terminalResult = {
                    status: 'aborted',
                    requestId,
                    reason: 'aborted',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: tailAssistant.value?.id,
                };
                if (tailAssistant.value?.pending)
                    tailAssistant.value.pending = false;
                try {
                    await hooks.doAction('ai.chat.send:action:after', {
                        threadId: requestThreadId,
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
                        const db = getDb();
                        await db.transaction(
                            'rw',
                            getWriteTxTableNames(db, 'messages', {
                                includeTombstones: true,
                            }),
                            async () => {
                                await db.messages.delete(
                                    tailAssistant.value!.id
                                );
                            }
                        );
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
                        const existing =
                            (await requestScope.originDb.messages.get(
                                tailAssistant.value.id
                            )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            requestScope.originDb,
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
                const visibleError = isStaleDevModuleError(err)
                    ? new Error(
                          'The development server reloaded while this message was starting. Reload OR3, then resend the message.'
                      )
                    : err;
                const terminalError =
                    visibleError instanceof Error
                        ? visibleError.message
                        : String(visibleError);
                terminalResult = {
                    status: 'failed',
                    requestId,
                    reason:
                        err instanceof ToolIterationLimitError
                            ? 'tool_iteration_limit'
                            : 'stream_error',
                    error: terminalError,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: tailAssistant.value?.id,
                };
                const lastUser = [...messages.value]
                    .reverse()
                    .find((m) => m.role === 'user');
                const retryFn = lastUser
                    ? () => {
                          void retryMessage(lastUser.id);
                      }
                    : undefined;
                // Inline tag object (Req 18.1) for clarity & tree-shaking
                reportError(visibleError, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: requestThreadId,
                        streamId: requestScope.streamId || '',
                        modelId: currentModelId || '',
                        stage: 'stream',
                    },
                    retry: retryFn,
                    toast: true,
                    retryable: !!retryFn,
                });
                const e =
                    visibleError instanceof Error
                        ? visibleError
                        : new Error(String(visibleError));
                requestScope.accumulator.finalize({ error: e });
                await hooks.doAction('ai.chat.stream:action:error', {
                    threadId: requestThreadId,
                    streamId: requestScope.streamId,
                    error: e,
                    aborted: false,
                });
                if (!tailAssistant.value?.text && tailAssistant.value?.id) {
                    try {
                        await requestScope.originDb.transaction(
                            'rw',
                            getWriteTxTableNames(
                                requestScope.originDb,
                                'messages',
                                {
                                    includeTombstones: true,
                                }
                            ),
                            async () => {
                                await requestScope.originDb.messages.delete(
                                    tailAssistant.value!.id
                                );
                            }
                        );
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
                        const existing =
                            (await requestScope.originDb.messages.get(
                                tailAssistant.value.id
                            )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            requestScope.originDb,
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
            // CRITICAL: Ensure abort controller is cleaned up to prevent memory leak
            if (activeRequestScope === requestScope) {
                loading.value = false;
                if (abortController.value) {
                    abortController.value = null;
                }
            }
            setTimeout(() => {
                if (
                    activeRequestScope === null &&
                    !loading.value &&
                    requestScope.accumulator.state.finalized
                ) {
                    resetStream();
                }
            }, 0);
        }
        return (
            terminalResult ?? {
                status: 'failed',
                requestId,
                reason: 'stream_error',
                error: 'Chat request ended without a terminal state.',
                userMessageId: userDbMsg.id,
            }
        );
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
        return await retryMessageImpl(
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
    let activeContinuationScope: {
        requestId: string;
        backgroundAdmissionId?: string;
        messageId?: string;
        settled: Promise<void>;
        resolveSettled: () => void;
    } | null = null;
    async function continueMessage(messageId: string, modelOverride?: string) {
        const requestId = newId();
        let resolveSettled!: () => void;
        const settled = new Promise<void>((resolve) => {
            resolveSettled = resolve;
        });
        activeContinuationScope = { requestId, settled, resolveSettled };
        try {
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
                    resolveInputTokenBudget: (selectedModelId: string) => {
                        const normalizedId = stripModelVariantSuffix(
                            stripThinkingSuffix(selectedModelId)
                        );
                        const { catalog, favoriteModels } = useModelStore();
                        const metadata =
                            catalog.value.find(
                                (candidate: ModelInfo) =>
                                    candidate.id === normalizedId
                            ) ||
                            favoriteModels.value.find(
                                (candidate: ModelInfo) =>
                                    candidate.id === normalizedId
                            );
                        return resolveChatInputTokenBudget(metadata);
                    },
                    backgroundStreamingAllowed:
                        backgroundStreamingAllowed.value,
                    workspaceId: getActiveWorkspaceId() ?? 'local',
                    userId: notificationUserId.value,
                    beginBackgroundAdmission: (admissionId, assistantId) => {
                        backgroundJobMode.value = 'background';
                        if (activeContinuationScope?.requestId === requestId) {
                            activeContinuationScope.backgroundAdmissionId =
                                admissionId;
                            activeContinuationScope.messageId = assistantId;
                        }
                    },
                    attachBackgroundJob: (params) => {
                        const ownsVisibleThread =
                            threadIdRef.value === params.threadId &&
                            !detached.value;
                        if (ownsVisibleThread) {
                            backgroundJobId.value = params.jobId;
                            backgroundJobInfo.value = {
                                jobId: params.jobId,
                                threadId: params.threadId,
                                messageId: params.messageId,
                            };
                            return attachBackgroundJobToUi({
                                ...params,
                                userId: notificationUserId.value,
                                workspaceId: params.workspaceId,
                                canonicalHistory: true,
                                useSse: backgroundStreamingAllowed.value,
                            });
                        }
                        return ensureBackgroundJobTracker({
                            ...params,
                            userId: notificationUserId.value,
                            workspaceId: params.workspaceId,
                            canonicalHistory: true,
                            preferServerNotifications:
                                serverNotificationsEnabled.value,
                            useSse: false,
                        });
                    },
                    resetStream,
                },
                messageId,
                modelOverride
            );
        } finally {
            if (activeContinuationScope?.requestId === requestId) {
                activeContinuationScope = null;
            }
            resolveSettled();
        }
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
    let disposed = false;

    function disposeHooks() {
        if (!cleanupFns.length) return;
        for (const dispose of cleanupFns.splice(0, cleanupFns.length)) {
            try {
                dispose();
            } catch {
                /* intentionally empty */
            }
        }
    }

    /** Release listeners/subscriptions without mutating conversation state. */
    function dispose() {
        if (disposed) return;
        disposed = true;
        workflowMessageScopes.clear();
        const keepTracking = Boolean(
            backgroundJobId.value ||
            backgroundJobMode.value !== 'none' ||
            (loading.value && abortController.value)
        );
        if (keepTracking) detached.value = true;
        clearBackgroundJobSubscriptions({ keepTracking });
        disposeHooks();
    }

    /** Clear only in-memory conversation projections; durable rows are preserved. */
    function clearConversation(options: { persistence?: 'preserve' } = {}) {
        if ((options.persistence ?? 'preserve') !== 'preserve') {
            throw new Error('Only persistence: "preserve" is supported');
        }
        rawMessages.value = [];
        messages.value = [];
        streamAcc.reset();
    }

    function setPendingPrompt(promptId: string | null | undefined) {
        pendingPromptIdRef.value = promptId || undefined;
    }

    /**
     * Rebind this instance to another thread without re-entering setup-only
     * composables (useToast/useHooks/useSessionContext).
     */
    async function switchThread(
        nextThreadId: string | undefined,
        switchOptions: {
            seedMessages?: ChatMessage[];
            pendingPromptId?: string | null;
            historyAlreadyLoaded?: boolean;
        } = {}
    ): Promise<void> {
        if (disposed) {
            throw new Error(
                'Cannot switchThread on a disposed useChat instance'
            );
        }

        const currentId = threadIdRef.value;
        if (nextThreadId && currentId && nextThreadId === currentId) {
            if (switchOptions.pendingPromptId !== undefined) {
                setPendingPrompt(switchOptions.pendingPromptId);
            }
            return;
        }

        // Invalidate in-flight navigation-scoped work (e.g. reattachment)
        // before awaiting anything below.
        bumpNavigationRevision();

        const isBackgroundActive =
            backgroundStreamingAllowed.value &&
            (backgroundJobId.value || backgroundJobMode.value !== 'none');
        const isForegroundStreamActive =
            loading.value &&
            !backgroundJobId.value &&
            backgroundJobMode.value === 'none' &&
            Boolean(abortController.value);

        if (isBackgroundActive) {
            // Background jobs are durable, so detach only their UI bindings.
            detached.value = true;
            clearBackgroundJobSubscriptions({ keepTracking: true });
        } else if (isForegroundStreamActive) {
            // Abort and fully settle a foreground stream before changing the
            // reactive thread. Its streaming callbacks share these refs, so
            // swapping first could append an old response to the new chat.
            // Continuations own the shared controller the same way but have no
            // send-message scope; await their settlement too.
            const foregroundScope = activeRequestScope;
            const continuationScope = activeContinuationScope;
            try {
                abortController.value?.abort();
            } catch {
                /* intentionally empty */
            }
            if (foregroundScope) await foregroundScope.settled;
            if (continuationScope) await continuationScope.settled;
        } else if (abortController.value) {
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {
                /* intentionally empty */
            }
            streamAcc.finalize({ aborted: true });
            abortController.value = null;
            clearBackgroundJobSubscriptions({ keepTracking: false });
        } else {
            // An admission can still be awaiting a filter, file hydration, or
            // new-thread creation before it has an AbortController. Fence it
            // so it cannot resume into the newly selected thread. A setup-phase
            // continuation has no shared controller yet either; its ownership
            // checks stop it, but await settlement before swapping refs.
            if (activeRequestScope) activeRequestScope.cancelled = true;
            const continuationScope = activeContinuationScope;
            if (continuationScope) await continuationScope.settled;
            clearBackgroundJobSubscriptions({ keepTracking: false });
        }

        threadIdRef.value = nextThreadId;
        if (switchOptions.pendingPromptId !== undefined) {
            setPendingPrompt(switchOptions.pendingPromptId);
        }
        historyLoadedFor.value =
            switchOptions.historyAlreadyLoaded && nextThreadId
                ? nextThreadId
                : null;
        backgroundJobId.value = null;
        backgroundJobMode.value = 'none';
        loading.value = false;
        requestState.value = { status: 'idle' };
        if (!isForegroundStreamActive) {
            activeRequestId = null;
            activeRequestScope = null;
        }
        aborted.value = false;
        streamId.value = undefined;
        tailAssistant.value = null;
        if (!isForegroundStreamActive) streamAcc.reset();
        detached.value = false;

        if (switchOptions.seedMessages) {
            replaceCanonicalHistory(switchOptions.seedMessages);
        } else {
            clearConversation({ persistence: 'preserve' });
        }

        await ensureHistorySynced();
    }

    function clear() {
        const isBackgroundActive =
            backgroundStreamingAllowed.value &&
            (backgroundJobId.value || backgroundJobMode.value !== 'none');
        const isForegroundStreamActive =
            loading.value &&
            !backgroundJobId.value &&
            backgroundJobMode.value === 'none' &&
            Boolean(abortController.value);

        if (isBackgroundActive || isForegroundStreamActive) {
            logBgStream('clear-detach-active-stream', {
                threadId: threadIdRef.value || null,
                isBackgroundActive,
                isForegroundStreamActive,
                backgroundJobId: backgroundJobId.value,
                backgroundJobMode: backgroundJobMode.value,
                loading: loading.value,
            });
            detached.value = true;
            dispose();
            // Do NOT reset backgroundJobId, backgroundJobMode, or backgroundJobInfo
            // This allows reattachment or background processing to continue.
            // Foreground streams are also detached here so they can finish when
            // users switch threads/routes mid-stream.
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

        dispose();
        clearConversation({ persistence: 'preserve' });
        logBgStream('clear-full-reset', {
            threadId: threadIdRef.value || null,
        });
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

    /** Atomically replaces both provider and presentation history projections. */
    function replaceCanonicalHistory(nextMessages: ChatMessage[]) {
        const nextRaw = nextMessages.map((message) => ({ ...message }));
        const nextUi = nextRaw
            .filter((message) => message.role !== 'tool')
            .map((message) => ensureUiMessage(message));
        rawMessages.value = nextRaw;
        messages.value = nextUi;
    }

    void reattachBackgroundJobs();
    // Seeded histories skip ensureHistorySynced, so recover abandoned
    // foreground generations on attach (e.g. refresh mid-stream).
    if (threadIdRef.value) {
        void reconcileForegroundGenerations().catch((error) => {
            if (import.meta.dev) {
                console.warn('[useChat] attach-time recovery failed', error);
            }
        });
    }

    if (getCurrentScope()) {
        onScopeDispose(() => {
            clear();
        });
    }

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
    const backgroundStopsInFlight = new Set<string>();

    /**
     * Projects a confirmed stop into UI and durable state. Only call after the
     * server acknowledged cancellation (job or admission marker). Shared UI
     * state is only touched while the stopped job/admission still owns the
     * visible view, so a late confirmation cannot abort a newer request.
     */
    function markBackgroundStopped(
        messageId: string | undefined,
        jobId?: string,
        admissionId?: string
    ): void {
        const ownsView =
            (jobId !== undefined && backgroundJobId.value === jobId) ||
            (admissionId !== undefined &&
                (activeRequestScope?.backgroundAdmissionId === admissionId ||
                    activeContinuationScope?.backgroundAdmissionId ===
                        admissionId));
        if (ownsView) {
            aborted.value = true;
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;
            if (abortController.value) {
                try {
                    abortController.value.abort();
                } catch {
                    /* intentionally empty */
                }
                abortController.value = null;
            }
            streamAcc.finalize({ aborted: true });
            if (tailAssistant.value?.pending) {
                tailAssistant.value.pending = false;
            }
        }
        if (!messageId) return;
        if (ownsView) {
            const target = resolveUiMessage(messageId);
            if (target) {
                target.pending = false;
                target.error = 'stopped';
                messages.value = [...messages.value];
            }
        }
        const trackerDb =
            (jobId ? backgroundJobTrackers.get(jobId)?.originDb : null) ??
            getDb();
        const canonicalHistory =
            admissionId !== undefined ||
            (jobId
                ? backgroundJobTrackers.get(jobId)?.canonicalHistory === true
                : false);
        const persistStop = canonicalHistory
            ? projectCanonicalBackgroundMessage
            : updateMessageRecord;
        void persistStop(trackerDb, messageId, {
            pending: false,
            error: 'stopped',
            data: {
                background_job_status: 'aborted',
                generation_state: 'aborted',
                error: 'stopped',
            },
        }).catch(() => {
            /* durable projection is best-effort here; tracker also persists */
        });
    }

    async function confirmBackgroundStop(
        jobId: string,
        info: { messageId?: string } | null
    ): Promise<void> {
        if (backgroundStopsInFlight.has(jobId)) return;
        backgroundStopsInFlight.add(jobId);
        logBgStream('abort-background-request', {
            jobId,
            messageId: info?.messageId ?? null,
        });
        try {
            const aborted = await abortBackgroundJob(jobId);
            if (aborted) {
                logBgStream('abort-background-confirmed', { jobId });
                markBackgroundStopped(info?.messageId, jobId);
                return;
            }
            // The server did not confirm cancellation. Never label the row
            // stopped without evidence: reconcile the actual terminal state.
            const status = await pollJobStatus(jobId).catch(() => null);
            if (status && status.status !== 'streaming') {
                logBgStream('abort-background-already-terminal', {
                    jobId,
                    status: status.status,
                });
                return;
            }
            logBgStream('abort-background-unconfirmed', { jobId });
            toast.add({
                title: 'Stop not confirmed',
                description:
                    'The server did not confirm cancellation. The response may still be running.',
                color: 'warning',
                duration: 4000,
            });
        } catch (error) {
            logBgStream('abort-background-request-failed', {
                jobId,
                error: error instanceof Error ? error.message : String(error),
            });
            toast.add({
                title: 'Stop request failed',
                description:
                    'Could not reach the server to confirm cancellation. The response may still be running.',
                color: 'warning',
                duration: 4000,
            });
        } finally {
            backgroundStopsInFlight.delete(jobId);
        }
    }

    async function confirmAdmissionStop(admissionId: string): Promise<void> {
        if (backgroundStopsInFlight.has(admissionId)) return;
        backgroundStopsInFlight.add(admissionId);
        const scope = activeRequestScope;
        const continuation =
            activeContinuationScope?.backgroundAdmissionId === admissionId
                ? activeContinuationScope
                : null;
        const messageId = scope?.assistantMessageId ?? continuation?.messageId;
        logBgStream('abort-admission-request', {
            admissionId,
            messageId: messageId ?? null,
        });
        // Cancel our own in-flight admission request immediately; the server
        // request below ensures a job that committed anyway gets cancelled.
        try {
            (scope?.abortController ?? abortController.value)?.abort();
        } catch {
            /* intentionally empty */
        }
        try {
            const result = await abortBackgroundAdmission(admissionId);
            if (result.aborted || result.pending) {
                // `pending` means the server recorded a cancellation marker that
                // the admission commit must honor, so projecting stopped is safe.
                if (scope) scope.cancelled = true;
                aborted.value = true;
                markBackgroundStopped(messageId, result.jobId, admissionId);
                logBgStream('abort-admission-confirmed', {
                    admissionId,
                    aborted: result.aborted,
                    pending: result.pending,
                    jobId: result.jobId ?? null,
                });
                return;
            }
            logBgStream('abort-admission-unconfirmed', { admissionId });
            toast.add({
                title: 'Stop not confirmed',
                description:
                    'The server did not confirm cancellation. The response may still be running.',
                color: 'warning',
                duration: 4000,
            });
        } catch (error) {
            logBgStream('abort-admission-request-failed', {
                admissionId,
                error: error instanceof Error ? error.message : String(error),
            });
            toast.add({
                title: 'Stop request failed',
                description:
                    'Could not reach the server to confirm cancellation. The response may still be running.',
                color: 'warning',
                duration: 4000,
            });
        } finally {
            backgroundStopsInFlight.delete(admissionId);
        }
    }

    function abortChat() {
        if (backgroundJobId.value) {
            // Confirmation-first: the row is only marked stopped after the
            // server acknowledges cancellation.
            void confirmBackgroundStop(
                backgroundJobId.value,
                backgroundJobInfo.value
            );
            return;
        }
        const pendingAdmissionId =
            activeRequestScope?.backgroundAdmissionId ??
            activeContinuationScope?.backgroundAdmissionId;
        if (backgroundJobMode.value === 'background' && pendingAdmissionId) {
            void confirmAdmissionStop(pendingAdmissionId);
            return;
        }

        const requestScope = activeRequestScope;
        const requestAbortController =
            requestScope?.abortController ?? abortController.value;
        if (!loading.value || !requestAbortController) {
            logBgStream('abort-ignored-no-active-foreground', {
                loading: loading.value,
                hasAbortController: Boolean(abortController.value),
                threadId: threadIdRef.value || null,
            });
            return;
        }
        logBgStream('abort-foreground-stream', {
            threadId: threadIdRef.value || null,
            streamId: streamId.value || null,
        });
        aborted.value = true;
        try {
            requestAbortController.abort();
        } catch {
            /* intentionally empty */
        }
        (requestScope?.accumulator ?? streamAcc).finalize({ aborted: true });
        if (tailAssistant.value?.pending) tailAssistant.value.pending = false;
        try {
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
        requestState,
        backgroundJobId,
        backgroundJobMode,
        threadId: threadIdRef,
        streamId,
        resetStream,
        streamState,
        tailAssistant,
        flushTailAssistant,
        applyLocalEdit,
        replaceCanonicalHistory,
        ensureHistorySynced,
        abort: abortChat,
        clear,
        clearConversation,
        dispose,
        switchThread,
        setPendingPrompt,
    };
}
