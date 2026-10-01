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

import {
    ref,
    shallowRef,
    shallowReactive,
    computed,
    watch,
    onScopeDispose,
    getCurrentScope,
} from 'vue';
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
import {
    createChatRequest,
    cancelRequest,
    finalizeRequest,
    publishRequest,
    projectTerminalMessages,
    settleRequest,
    type ChatRequest as ChatRequestScope,
    type RequestFinalization,
} from '~/utils/chat/useAi-internal/requestController';
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
import type { OpenRouterModel } from '~~/shared/openrouter/types';
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
    const visibleRequest = shallowRef<ChatRequestScope | null>(null);
    const backgroundRequestScopes = shallowReactive(
        new Map<string, ChatRequestScope>()
    );
    const loading = computed(
        () =>
            Boolean(
                visibleRequest.value?.attached.value &&
                visibleRequest.value.phase.value !== 'terminal'
            ) ||
            Array.from(backgroundRequestScopes.values()).some(
                (request) =>
                    request.phase.value !== 'terminal' && request.ownsView()
            )
    );
    const requestState = computed<ChatRequestState>(
        () => visibleRequest.value?.publicState.value ?? { status: 'idle' }
    );
    let activeRequestId: string | null = null;
    const abortController = ref<AbortController | null>(null);
    // Cancellation may change while an awaited operation is pending.
    const isRequestCancelled = (scope: ChatRequestScope): boolean => scope.cancelled;
    const aborted = ref<boolean>(false);
    const { apiKey, setKey } = useUserApiKey();
    const runtimeConfig = useRuntimeConfig();
    // Nuxt UI resolves its toast service through Vue injection. Capture it
    // while useChat is still running inside setup; calling useToast() later
    // from an async send handler triggers Vue's "inject() can only be used
    // inside setup()" warning.
    const toast = useToast();
    const unresolvedModelIds = new Set<string>();
    async function resolveModelMetadata(
        selectedModelId: string
    ): Promise<OpenRouterModel | undefined> {
        const modelId = stripModelVariantSuffix(
            stripThinkingSuffix(selectedModelId)
        );
        const { catalog, favoriteModels, fetchModels } = useModelStore();
        const matches = (candidate: OpenRouterModel) =>
            candidate.id === modelId || candidate.canonical_slug === modelId;
        const lookup = () =>
            catalog.value.find(matches) ?? favoriteModels.value.find(matches);
        const hasContext = (candidate: OpenRouterModel | undefined) =>
            [
                candidate?.top_provider?.context_length,
                candidate?.context_length,
            ].some(
                (value) =>
                    typeof value === 'number' &&
                    Number.isFinite(value) &&
                    value > 0
            );

        let metadata = lookup();
        if (hasContext(metadata) || unresolvedModelIds.has(modelId)) return metadata;
        try {
            await fetchModels();
            metadata = lookup();
            if (!hasContext(metadata)) {
                await fetchModels({ force: true });
                metadata = lookup();
            }
            if (!hasContext(metadata)) unresolvedModelIds.add(modelId);
        } catch {
            // Keep the conservative fallback if catalog metadata is unavailable.
        }
        return metadata;
    }
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
    let activeRequestScope: ChatRequestScope | null = null;
    function admitRequest(
        kind: ChatRequestScope['kind'],
        threadId = threadIdRef.value,
        originDb = getDb(),
        workspaceId = getActiveWorkspaceId() ?? 'local'
    ): ChatRequestScope {
        const scope = createChatRequest({
            requestId: newId(),
            kind,
            threadId,
            originDb,
            workspaceId,
            accumulator:
                kind === 'reattach' ? createStreamAccumulator() : streamAcc,
        });
        scope.ownsView = () =>
            visibleRequest.value === scope &&
            scope.attached.value &&
            !detached.value &&
            getDb() === scope.originDb &&
            threadIdRef.value === scope.threadId;
        scope.projectTerminal = (result) =>
            projectRequestTerminal(scope, result);
        visibleRequest.value = scope;
        return scope;
    }
    function projectRequestTerminal(
        scope: ChatRequestScope,
        result: RequestFinalization
    ): void {
        projectTerminalMessages(scope, result, {
            messages,
            rawMessages,
            tailAssistant,
        });
        if (
            scope.accumulator !== streamAcc &&
            tailAssistant.value?.id === scope.assistantMessageId
        ) {
            streamAcc.finalize({
                aborted: result.terminal.outcome === 'aborted',
                error:
                    result.terminal.outcome === 'failed' ||
                    result.persistenceError
                        ? (result.terminal.error ??
                          new Error(
                              String(
                                  result.persistenceError ??
                                      result.terminal.messageError ??
                                      'Chat request failed'
                              )
                          ))
                        : undefined,
            });
        }
        releaseBackgroundControls(scope);
    }
    function releaseBackgroundControls(scope: ChatRequestScope): void {
        if (!scope.jobId || backgroundJobId.value === scope.jobId) {
            const next = Array.from(backgroundRequestScopes.values()).find(
                (request) =>
                    request !== scope &&
                    request.phase.value === 'streaming' &&
                    request.ownsView()
            );
            if (next?.jobId && next.threadId && next.assistantMessageId) {
                visibleRequest.value = next;
                backgroundJobId.value = next.jobId;
                backgroundJobMode.value = 'background';
                backgroundJobInfo.value = {
                    jobId: next.jobId,
                    threadId: next.threadId,
                    messageId: next.assistantMessageId,
                };
                return;
            }
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;
        }
    }
    function reportFinalization(result: RequestFinalization): void {
        const failure = result.persistenceError ?? result.effectError;
        if (failure)
            reportError(
                err(
                    result.persistenceError
                        ? 'ERR_DB_WRITE_FAILED'
                        : 'ERR_HOOK_FAILURE',
                    'Failed to finalize the chat request.',
                    {
                        cause: failure,
                        tags: { domain: 'chat', stage: 'finalize' },
                    }
                ),
                { silent: true }
            );
    }
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
            scope.ownsView() &&
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
                backgroundStreamingConfig.value.enabled
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
            (payload: { messageId: string; state: unknown }) => {
                const state =
                    payload.state !== null && typeof payload.state === 'object'
                        ? (payload.state as Record<string, unknown>)
                        : {};
                const executionState = state.executionState;
                const isDone =
                    typeof executionState === 'string' &&
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
            const request = backgroundRequestScopes.get(jobId);
            if (request) request.attached.value = false;
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
        request?: ChatRequestScope;
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
        const request =
            params.request ??
            (backgroundRequestScopes.get(params.jobId)?.ownsView()
                ? backgroundRequestScopes.get(params.jobId)
                : null) ??
            (visibleRequest.value?.assistantMessageId === params.messageId &&
            visibleRequest.value.originDb === (params.originDb ?? getDb()) &&
            visibleRequest.value.attached.value &&
            !visibleRequest.value.finalization
                ? visibleRequest.value
                : null) ??
            admitRequest(
                'reattach',
                params.threadId,
                params.originDb ?? getDb(),
                params.workspaceId ?? getActiveWorkspaceId() ?? 'local'
            );
        request.assistantMessageId = params.messageId;
        request.streamId = params.generationId ?? request.streamId;
        request.jobId = params.jobId;
        request.lastAttempt = tracker.lastAttempt ?? params.initialAttempt;
        if (!request.finalization) request.phase.value = 'streaming';
        backgroundRequestScopes.set(params.jobId, request);
        const attachmentRevision = navigationRevision;
        request.ownsView = () =>
            backgroundRequestScopes.get(params.jobId) === request &&
            navigationRevision === attachmentRevision &&
            request.attached.value &&
            !detached.value &&
            getDb() === request.originDb &&
            threadIdRef.value === request.threadId;
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
        const finalizeBackground = async (
            outcome: 'completed' | 'failed' | 'aborted',
            update: Parameters<
                NonNullable<BackgroundJobSubscriber['onComplete']>
            >[0]
        ) => {
            if (
                typeof update.status.attempt === 'number' &&
                typeof request.lastAttempt === 'number' &&
                update.status.attempt < request.lastAttempt
            )
                return;
            if (request.ownsView() && !request.finalization) {
                request.message = resolveUiMessage(params.messageId);
                syncTailAccumulator(
                    params.messageId,
                    update.content,
                    update.content
                );
            }
            const messageError =
                outcome === 'aborted'
                    ? 'stopped'
                    : outcome === 'failed'
                      ? update.status.error || 'Background response failed'
                      : null;
            reportFinalization(
                await finalizeRequest(request, {
                    outcome,
                    content: update.content,
                    reasoning: update.reasoning,
                    toolCalls: normalizeBackgroundToolCalls(
                        update.status.tool_calls
                    ),
                    messageError,
                    error:
                        outcome === 'failed'
                            ? new Error(messageError!)
                            : undefined,
                    attempt: update.status.attempt,
                    persistence: 'tracker',
                })
            );
        };
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
                    if (
                        request.finalization ||
                        !request.ownsView() ||
                        (typeof status.attempt === 'number' &&
                            typeof request.lastAttempt === 'number' &&
                            status.attempt < request.lastAttempt)
                    ) {
                        return;
                    }
                    if (typeof status.attempt === 'number')
                        request.lastAttempt = status.attempt;
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    request.message = target;
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
                onComplete: (update) => {
                    void finalizeBackground('completed', update);
                },
                onError: (update) => {
                    void finalizeBackground('failed', update);
                },
                onAbort: (update) => {
                    void finalizeBackground('aborted', update);
                },
                onTransportError: ({ status }) => {
                    if (request.finalization) return;
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
                        request.ownsView() &&
                        status.trackingInterruptedKind === 'missing'
                    ) {
                        const target = resolveUiMessage(params.messageId);
                        if (target) {
                            target.pending = false;
                            target.error = 'stream_interrupted';
                            messages.value = [...messages.value];
                        }
                    }
                    if (request.ownsView()) {
                        request.attached.value = false;
                        releaseBackgroundControls(request);
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
        // Completion also covers cached terminal trackers, whose subscribers
        // have already received their one terminal notification.
        void tracker.completion
            .then(async (status) => {
                if (status.trackingInterrupted) {
                    if (!request.finalization && request.ownsView()) {
                        request.attached.value = false;
                        releaseBackgroundControls(request);
                    }
                    return;
                }
                await finalizeBackground(
                    status.status === 'complete'
                        ? 'completed'
                        : status.status === 'aborted'
                          ? 'aborted'
                          : 'failed',
                    {
                        status,
                        content: status.content ?? tracker.terminalContent ?? tracker.lastContent,
                        reasoning: status.reasoning_text ?? tracker.lastReasoning,
                        delta: '',
                    }
                );
            })
            .catch((error) => {
                reportError(error, {
                    code: 'ERR_INTERNAL',
                    tags: { domain: 'chat', stage: 'background_finalize' },
                });
            })
            .finally(() => {
                if (backgroundRequestScopes.get(params.jobId) === request)
                    backgroundRequestScopes.delete(params.jobId);
            });
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
        const reconcileWorkspaceId = getActiveWorkspaceId() ?? 'local';
        const reconcileRevision = navigationRevision;
        const persisted = (await messagesByThread(reconcileThreadId)) as
            | StoredMessage[]
            | undefined;
        // Stale query results must never touch a newer thread's view.
        if (
            navigationRevision !== reconcileRevision ||
            getDb() !== reconcileDb ||
            threadIdRef.value !== reconcileThreadId
        )
            return;
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
                    const recovery = createChatRequest({
                        requestId: newId(),
                        originDb: reconcileDb,
                        workspaceId: reconcileWorkspaceId,
                        threadId: reconcileThreadId,
                        kind: 'recovery',
                        accumulator: createStreamAccumulator(),
                    });
                    recovery.assistantMessageId = row.id;
                    recovery.assistantRecord = latest;
                    recovery.streamId =
                        typeof latest.data?.generation_id === 'string'
                            ? latest.data.generation_id
                            : undefined;
                    recovery.ownsView = () =>
                        navigationRevision === reconcileRevision &&
                        threadIdRef.value === reconcileThreadId &&
                        getDb() === reconcileDb;
                    recovery.projectTerminal = (result) =>
                        projectTerminalMessages(recovery, result, {
                            messages,
                            rawMessages,
                            tailAssistant,
                        });
                    const result = await finalizeRequest(recovery, {
                        outcome: 'failed',
                        messageError: 'stream_interrupted',
                        generationState: 'interrupted',
                        content: deriveMessageContent(latest),
                        reasoning:
                            latest.data?.reasoning_text ??
                            latest.reasoning_text ??
                            null,
                        toolCalls: latest.data?.tool_calls ?? null,
                    });
                    reportFinalization(result);
                    finalizedHere =
                        !result.persistenceError && !result.superseded;
                }
                // Only mutate the live view while it still shows this thread.
                // Project the durable terminal state even when a concurrent
                // recovery already finalized the row, so an older pending
                // projection (e.g. seeded history) never strands the UI.
                if (
                    navigationRevision !== reconcileRevision ||
                    getDb() !== reconcileDb ||
                    threadIdRef.value !== reconcileThreadId
                )
                    return;
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
                backgroundJobId.value = jobId;
                backgroundJobInfo.value = {
                    jobId,
                    threadId: reattachThreadId,
                    messageId: msg.id,
                };
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
        if (activeRequestId || loading.value)
            return { status: 'rejected', reason: 'busy' };
        const requestScope = admitRequest('send');
        const requestId = requestScope.requestId;
        activeRequestId = requestId;
        activeRequestScope = requestScope;
        requestScope.accumulator.reset();
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
            if (!requestScope.finalization && result.status !== 'detached') {
                const finalization = await finalizeRequest(requestScope, {
                    outcome:
                        result.status === 'aborted'
                            ? 'aborted'
                            : result.status === 'complete'
                              ? 'completed'
                              : 'failed',
                    error:
                        'error' in result && result.error
                            ? new Error(result.error)
                            : undefined,
                    messageError:
                        result.status === 'aborted'
                            ? 'stopped'
                            : 'error' in result
                              ? result.error
                              : undefined,
                    persistence: requestScope.jobId ? 'tracker' : 'request',
                });
                reportFinalization(finalization);
            }
            if (activeRequestId === requestId) activeRequestId = null;
            if (activeRequestScope === requestScope) {
                activeRequestScope = null;
                abortController.value = null;
            }
            settleRequest(requestScope, result);
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
            isRequestCancelled(requestScope) ||
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
            if (isRequestCancelled(requestScope)) {
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
        if (isRequestCancelled(requestScope) || threadIdRef.value !== requestThreadId) {
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
        requestScope.userMessageId = userDbMsg.id;
        publishRequest(requestScope, {
            status: 'persisted',
            requestId,
            userMessageId: userDbMsg.id,
        });
        if (sendMessagesParams.onUserPersisted) {
            try {
                await sendMessagesParams.onUserPersisted(userDbMsg.id);
            } catch (error) {
                reportError(
                    err('ERR_INTERNAL', 'Failed to finalize retried turn', {
                        severity: 'error',
                        tags: { domain: 'chat', stage: 'retry-persisted' },
                    }),
                    { toast: true }
                );
                if (import.meta.dev) console.warn('[useChat] retry persistence callback failed', error);
            }
        }
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
                isRequestCancelled(requestScope) ||
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

            const budgetModelMeta = await resolveModelMetadata(modelId);
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
                isRequestCancelled(requestScope) ||
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
            requestScope.assistantRecord = assistantDbMsg;
            publishRequest(requestScope, {
                status: 'streaming',
                requestId,
                userMessageId: userDbMsg.id,
                assistantMessageId: assistantDbMsg.id,
            });
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
            const modelSupportsTools = !budgetModelMeta?.supported_parameters
                || budgetModelMeta.supported_parameters.includes('tools');
            const enabledToolDefs = modelSupportsTools ? toolRegistry.getEnabledDefinitions({
                workspaceId: requestScope.workspaceId,
                threadId: requestThreadId,
            }) : [];
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
            if (isRequestCancelled(requestScope) || !requestScope.ownsView())
                throw new DOMException('Chat request cancelled', 'AbortError');

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
                requestScope.message = resolveUiMessage(assistantDbMsg.id);
                reportFinalization(
                    await finalizeRequest(requestScope, {
                        outcome: 'failed',
                        error: new Error(emptyContextError),
                        messageError: 'empty_context',
                        generationState: 'error',
                    })
                );
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
            if (isRequestCancelled(requestScope) || !ownsCurrentView(requestScope)) {
                reportFinalization(await finalizeRequest(requestScope, {
                    outcome: 'aborted', messageError: 'stopped', deleteEmpty: true,
                }));
                return { status: 'aborted', requestId, reason: 'aborted', userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
            }
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
                requestScope.message = uiAssistant;

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
                    requestScope.jobId = result.jobId;
                    if (isRequestCancelled(requestScope) && requestScope.stopConfirmation) {
                        throw new DOMException('Admission cancelled', 'AbortError');
                    }

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

                    requestScope.jobId = result.jobId;
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
                              request: requestScope,
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
                    if (completion.trackingInterrupted) {
                        requestScope.attached.value = false;
                        return {
                            status: 'detached',
                            requestId,
                            reason: 'detached',
                            userMessageId: userDbMsg.id,
                            assistantMessageId: assistantDbMsg.id,
                        };
                    }
                    reportFinalization(
                        await finalizeRequest(requestScope, {
                            outcome:
                                completion.status === 'complete'
                                    ? 'completed'
                                    : completion.status === 'aborted'
                                      ? 'aborted'
                                      : 'failed',
                            content: completion.content ?? tracker.lastContent,
                            reasoning: completion.reasoning_text,
                            toolCalls: normalizeBackgroundToolCalls(
                                completion.tool_calls
                            ),
                            messageError:
                                completion.status === 'complete'
                                    ? null
                                    : completion.status === 'aborted'
                                      ? 'stopped'
                                      : (completion.error ??
                                        'Background stream failed'),
                            persistence: 'tracker',
                            attempt: completion.attempt,
                        })
                    );
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
                        isRequestCancelled(requestScope) ||
                        requestScope.abortController.signal.aborted ||
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
                    requestScope.message = ownsView
                        ? resolveUiMessage(assistantDbMsg.id)
                        : requestScope.message;
                    reportFinalization(
                        await finalizeRequest(requestScope, {
                            outcome: 'failed',
                            error: new Error(errMessage),
                            messageError: errMessage,
                        })
                    );
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
            requestScope.message = current;
            const finalization = await finalizeRequest(requestScope, {
                outcome: 'completed',
                content: incoming,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                afterPersist: async () => {
                    // Write the finished turn (assistant + tool rows) back into the
                    // canonical history. Without this, rawMessages keeps the empty
                    // placeholder and the next request loses the answer and tools.
                    try {
                        if (requestScope.ownsView())
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
                                    reasoningLength: (
                                        current.reasoning_text || ''
                                    ).length,
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
                },
            });
            reportFinalization(finalization);
            if (finalization.persistenceError) {
                return {
                    status: 'failed',
                    requestId,
                    reason: 'stream_error',
                    error:
                        finalization.persistenceError instanceof Error
                            ? finalization.persistenceError.message
                            : String(finalization.persistenceError),
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }
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
                visibleRequest.value === requestScope &&
                tailAssistant.value?.id === requestScope.assistantMessageId
            )
                requestScope.message = tailAssistant.value;
            const stopped =
                isRequestCancelled(requestScope) ||
                requestScope.abortController?.signal.aborted === true;
            if (
                stopped &&
                requestScope.stopConfirmation &&
                !(await requestScope.stopConfirmation)
            ) {
                requestScope.attached.value = false;
                return {
                    status: 'detached',
                    requestId,
                    reason: 'detached',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: requestScope.assistantMessageId,
                };
            }
            const visibleError = isStaleDevModuleError(err)
                ? new Error(
                      'The development server reloaded while this message was starting. Reload OR3, then resend the message.'
                  )
                : err instanceof Error
                  ? err
                  : new Error(String(err));
            if (stopped) {
                terminalResult = {
                    status: 'aborted',
                    requestId,
                    reason: 'aborted',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: requestScope.assistantMessageId,
                };
                reportFinalization(
                    await finalizeRequest(requestScope, {
                        outcome: 'aborted',
                        messageError: 'stopped',
                        deleteEmpty: true,
                        persistence: requestScope.backgroundAdmissionId
                            ? 'tracker'
                            : 'request',
                        beforePersist: async () => {
                            await hooks.doAction('ai.chat.send:action:after', {
                                threadId: requestThreadId,
                                aborted: true,
                            });
                        },
                    })
                );
            } else {
                terminalResult = {
                    status: 'failed',
                    requestId,
                    reason:
                        err instanceof ToolIterationLimitError
                            ? 'tool_iteration_limit'
                            : 'stream_error',
                    error: visibleError.message,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: requestScope.assistantMessageId,
                };
                reportError(visibleError, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: requestThreadId,
                        streamId: requestScope.streamId || '',
                        modelId: currentModelId || '',
                        stage: 'stream',
                    },
                    toast: true,
                });
                reportFinalization(
                    await finalizeRequest(requestScope, {
                        outcome: 'failed',
                        error: visibleError,
                        messageError: 'stream_interrupted',
                        generationState: 'interrupted',
                        deleteEmpty: true,
                        beforePersist: async () => {
                            if (requestScope.ownsView())
                                requestScope.accumulator.finalize({
                                    error: visibleError,
                                });
                            await hooks.doAction(
                                'ai.chat.stream:action:error',
                                {
                                    threadId: requestThreadId,
                                    streamId: requestScope.streamId,
                                    error: visibleError,
                                    aborted: false,
                                }
                            );
                        },
                    })
                );
            }
        } finally {
            // CRITICAL: Ensure abort controller is cleaned up to prevent memory leak
            if (activeRequestScope === requestScope) {
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
        return terminalResult;
    }

    // END sendMessage

    /**
     * Purpose:
     * Retries a prior turn by moving its user/assistant pair to the bottom.
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
    let activeContinuationScope: ChatRequestScope | null = null;
    function getContinuationScope(): ChatRequestScope | null { return activeContinuationScope; }
    async function continueMessage(messageId: string, modelOverride?: string) {
        if (loading.value || activeRequestId) return;
        const request = admitRequest('continue');
        const requestId = request.requestId;
        activeContinuationScope = request;
        try {
            await continueMessageImpl(
                {
                    request,
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
                    resolveInputTokenBudget: async (selectedModelId: string) =>
                        resolveChatInputTokenBudget(
                            await resolveModelMetadata(selectedModelId)
                        ),
                    backgroundStreamingAllowed:
                        backgroundStreamingAllowed.value,
                    workspaceId: request.workspaceId,
                    userId: notificationUserId.value,
                    beginBackgroundAdmission: (admissionId, assistantId) => {
                        backgroundJobMode.value = 'background';
                        const continuationScope = activeContinuationScope;
                        if (continuationScope?.requestId === requestId) {
                            continuationScope.backgroundAdmissionId =
                                admissionId;
                            continuationScope.assistantMessageId =
                                assistantId;
                        }
                    },
                    attachBackgroundJob: (params) => {
                        const ownsVisibleThread = request.ownsView();
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
                                request,
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
            if (!request.finalization && request.attached.value)
                reportFinalization(
                    await finalizeRequest(request, {
                        outcome: request.cancelled ? 'aborted' : 'failed',
                        messageError: request.cancelled
                            ? 'stopped'
                            : 'stream_interrupted',
                    })
                );
            if (request.finalization) await request.finalization;
            const finalState = request.publicState.value;
            settleRequest(
                request,
                finalState.status === 'terminal'
                    ? finalState.result
                    : {
                          status: 'detached',
                          requestId,
                          reason: 'detached',
                          assistantMessageId: request.assistantMessageId,
                      }
            );
            const continuationScope = getContinuationScope();
            if (continuationScope?.requestId === requestId) {
                activeContinuationScope = null;
            }
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
        if (visibleRequest.value) visibleRequest.value.attached.value = false;
        clearBackgroundJobSubscriptions({ keepTracking });
        disposeHooks();
    }

    /** Clear only in-memory conversation projections; durable rows are preserved. */
    function clearConversation(options: { persistence?: 'preserve' } = {}) {
        if (((options as { persistence?: unknown }).persistence ?? 'preserve') !== 'preserve') {
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
            if (visibleRequest.value)
                visibleRequest.value.attached.value = false;
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
                if (foregroundScope) cancelRequest(foregroundScope);
                if (continuationScope) cancelRequest(continuationScope);
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
            if (continuationScope) cancelRequest(continuationScope);
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

        visibleRequest.value = null;
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
    async function markBackgroundStopped(
        request: ChatRequestScope | undefined
    ): Promise<void> {
        if (!request) return;
        if (request.ownsView()) {
            request.message = request.assistantMessageId
                ? (resolveUiMessage(request.assistantMessageId) ??
                  request.message)
                : request.message;
            aborted.value = true;
        }
        cancelRequest(request);
        reportFinalization(
            await finalizeRequest(request, {
                outcome: 'aborted',
                messageError: 'stopped',
                persistence: 'canonical',
            })
        );
    }

    async function confirmBackgroundStop(
        jobId: string,
        info: { messageId?: string } | null
    ): Promise<void> {
        if (backgroundStopsInFlight.has(jobId)) return;
        backgroundStopsInFlight.add(jobId);
        const request = backgroundRequestScopes.get(jobId);
        logBgStream('abort-background-request', {
            jobId,
            messageId: info?.messageId ?? null,
        });
        try {
            const aborted = await abortBackgroundJob(jobId);
            if (aborted) {
                logBgStream('abort-background-confirmed', { jobId });
                await markBackgroundStopped(request);
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

    async function confirmAdmissionStop(admissionId: string): Promise<boolean> {
        if (backgroundStopsInFlight.has(admissionId)) return false;
        backgroundStopsInFlight.add(admissionId);
        const scope =
            activeRequestScope?.backgroundAdmissionId === admissionId
                ? activeRequestScope
                : null;
        const continuation =
            activeContinuationScope?.backgroundAdmissionId === admissionId
                ? activeContinuationScope
                : null;
        const messageId =
            scope?.assistantMessageId ?? continuation?.assistantMessageId;
        logBgStream('abort-admission-request', {
            admissionId,
            messageId: messageId ?? null,
        });
        // Cancel our own in-flight admission request immediately; the server
        // request below ensures a job that committed anyway gets cancelled.
        try {
            const request = scope ?? continuation;
            if (request) cancelRequest(request);
        } catch {
            /* intentionally empty */
        }
        try {
            const result = await abortBackgroundAdmission(admissionId);
            if (result.aborted || result.pending) {
                // `pending` means the server recorded a cancellation marker that
                // the admission commit must honor, so projecting stopped is safe.
                await markBackgroundStopped(scope ?? continuation ?? undefined);
                logBgStream('abort-admission-confirmed', {
                    admissionId,
                    aborted: result.aborted,
                    pending: result.pending,
                    jobId: result.jobId ?? null,
                });
                return true;
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
        return false;
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
            const request = activeRequestScope ?? activeContinuationScope;
            if (request && !request.stopConfirmation)
                request.stopConfirmation =
                    confirmAdmissionStop(pendingAdmissionId);
            return;
        }

        const requestScope =
            activeRequestScope ??
            activeContinuationScope ??
            visibleRequest.value;
        if (!loading.value || !requestScope) {
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
            cancelRequest(requestScope);
        } catch {
            /* intentionally empty */
        }
        requestScope.accumulator.finalize({ aborted: true });
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
