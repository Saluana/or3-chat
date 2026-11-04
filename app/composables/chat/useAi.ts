/** Public chat facade: composes view, preparation, execution, and durable request owners. */
import { ref, shallowRef, shallowReactive, computed, watch, onScopeDispose, getCurrentScope } from 'vue';
import { useToast, useAppConfig, useRuntimeConfig, useUserApiKey, useActivePrompt, useHooks } from '#imports';
import { newId } from '~/db/util';
import { getDb, getActiveWorkspaceId, getWorkspaceGeneration } from '~/db/client';
import { getKvRecordByName, setKvByName } from '~/db/kv';
import { parseHashes } from '~/utils/files/attachments';
import type { ContentPart, ChatMessage, SendMessageParams, SendResult, ChatRequestState } from '~/utils/chat/types';
import { ensureUiMessage, type UiChatMessage } from '~/utils/chat/uiMessages';
import { deriveMessageContent } from '~/utils/chat/messages';
import { associateUiToolResultMessages } from '~/utils/chat/transcript';
import { discardStaleRecovery } from '~/utils/chat/native-recovery';
import { chatToolPreferenceKey } from '~/utils/chat/tool-preferences';
import { reportError, err } from '~/utils/errors';
import { errorDiagnostics } from '~~/shared/errors';
import { ToolIterationLimitError } from '~~/shared/chat/stream-errors';
import { MAX_CANONICAL_MESSAGE_OUTPUT_BYTES } from '~~/shared/chat/tool-limits';
import { ChatContextAdmissionError, contextAdmissionFailureReason } from '~~/shared/chat/context-budget';
import { redactDiagnosticDetails } from '~~/shared/logging/sensitive-metadata';
import { openRouterCatalogLookupId } from '~~/shared/openrouter/selection';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { abortBackgroundJob, abortBackgroundAdmission, pollJobStatus, isBackgroundStreamingEnabled } from '../../utils/chat/openrouterStream';
import { createStreamAccumulator } from '~/composables/chat/useStreamAccumulator';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { state } from '~/state/global';
import type { PaneContext } from '../../../types/chat-internal';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { StoredMessage } from '~/utils/chat/useAi-internal/nativeExecutionTypes';
import { resolveSystemPromptText } from '~/utils/chat/useAi-internal/messageBuild';
import { createNativeRecovery, createNativeRecoveryCandidates } from '~/utils/chat/useAi-internal/nativeRecovery';
import { createNativeExecution } from '~/utils/chat/useAi-internal/nativeExecution';
import { acceptUserTurn } from '~/utils/chat/useAi-internal/turnAcceptance';
import { createTurnPreparation } from '~/utils/chat/useAi-internal/turnPreparation';
import { createTurnDispatch } from '~/utils/chat/useAi-internal/turnDispatch';
import { createBackgroundAttachmentCoordinator } from '~/utils/chat/useAi-internal/backgroundAttachment';
import { createHistorySynchronizer } from '~/utils/chat/useAi-internal/historySync';
import { createChatViewProjection } from '~/utils/chat/useAi-internal/viewProjection';
import { createChatRequest, cancelRequest, finalizeRequest, retryRequestFinalization, publishRequest,
    projectTerminalMessages, settleRequest, type ChatRequest as ChatRequestScope,
    type RequestFinalization } from '~/utils/chat/useAi-internal/requestController';

const DEFAULT_AI_MODEL = '~openai/gpt-luna-latest';

type GlobalWithPaneApi = typeof globalThis & {
    __or3MultiPaneApi?: UseMultiPaneApi;
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
    pendingPromptId?: string,
    options: { historyAlreadyLoaded?: boolean; forceForeground?: boolean; excludedTools?: readonly string[]; toolDraftId?: () => string | undefined } = {}
) {
    // Messages and basic state
    const { messages, rawMessages, tailAssistant, flushTailAssistant, resolveUiMessage,
        syncTailAccumulator, applyLocalEdit, replaceCanonicalHistory } = createChatViewProjection(msgs, () => streamAcc);
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
    const { apiKey, connected, setKey } = useUserApiKey();
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
        const admissionRevision = navigationRevision;
        const scope = createChatRequest({
            requestId: newId(),
            kind,
            threadId,
            originDb,
            workspaceId,
            originUserId: notificationUserId.value,
            accumulator:
                kind === 'reattach' ? createStreamAccumulator() : streamAcc,
        });
        scope.ownsView = () =>
            visibleRequest.value === scope &&
            scope.attached.value &&
            !detached.value &&
            navigationRevision === admissionRevision &&
            notificationUserId.value === scope.originUserId &&
            getDb() === scope.originDb &&
            threadIdRef.value === scope.threadId;
        scope.projectTerminal = (result) =>
            projectRequestTerminal(scope, result);
        const saveNoticeId = `terminal-local-save:${scope.requestId}`;
        scope.onFinalizationResult = (result) => {
            if (!result.persistenceError || result.superseded || result.terminal.persistence === 'canonical' || result.terminal.persistence === 'tracker') { toast.remove(saveNoticeId); return; }
            toast.add({ id: saveNoticeId, title: 'Response could not be saved locally',
                description: 'The final response is still held in this browser and local saving is being retried. Keep this page open until it saves.',
                color: 'warning', duration: 0,
                actions: [{ label: 'Retry local save', onClick: () => { void retryRequestFinalization(scope); } }],
            });
        };
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
        clearForegroundReconcileTimers();
    }
    // Account switches invalidate in-flight view ownership even when the
    // workspace database and thread happen to stay the same.
    watch(notificationUserId, () => bumpNavigationRevision(), { flush: 'sync' });
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

    function isStaleDevModuleError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return /failed to fetch dynamically imported module/i.test(message);
    }

    const { reconcileForegroundGenerations, reattachBackgroundJobs, clearForegroundReconcileTimers,
        clearBackgroundJobSubscriptions, attachBackgroundJobToUi, ensureScopedBackgroundTracker,
        normalizeBackgroundToolCalls, attachedCount } =
        createBackgroundAttachmentCoordinator({
            view: { messages, rawMessages, tailAssistant }, threadIdRef, loading,
            backgroundStreamingAllowed, notificationUserId, detached, backgroundJobId, backgroundJobMode,
            backgroundJobInfo, navigationRevision: () => navigationRevision,
            disposed: () => disposed, reportFinalization, logBgStream, warnBgStream,
            backgroundRequestScopes, visibleRequest, serverNotificationsEnabled, streamAcc,
            resolveUiMessage, syncTailAccumulator, admitRequest, releaseBackgroundControls,
        });
    cleanupFns.push(clearForegroundReconcileTimers);

    const ensureHistorySynced = createHistorySynchronizer({
        threadId: threadIdRef, loadedFor: historyLoadedFor, detached,
        disposed: () => disposed,
        captureOwner: target => {
            const db = getDb(); const generation = getWorkspaceGeneration();
            const userId = notificationUserId.value; const revision = navigationRevision;
            return () => !disposed && navigationRevision === revision && notificationUserId.value === userId
                && getDb() === db && getWorkspaceGeneration() === generation && threadIdRef.value === target;
        },
        publish: (history, target) => {
            rawMessages.value = history;
            historyLoadedFor.value = target;
            messages.value = associateUiToolResultMessages(history.filter(message => message.role !== 'tool')
                .map(message => ensureUiMessage(message)), history);
        },
        attach: reattachBackgroundJobs,
        reconcile: reconcileForegroundGenerations,
        counts: () => ({ rawCount: rawMessages.value.length, uiCount: messages.value.length,
            attachedJobs: attachedCount() }),
        log: logBgStream,
    });

    let lastSuppressedAssistantId: string | null = null;


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
            // IndexedDB transaction aborts also use AbortError. Only request
            // cancellation may suppress a failed-save notice before admission.
            const stopped = requestScope.cancelled || requestScope.abortController?.signal.aborted === true;
            result = stopped ? { status: 'aborted', requestId, reason: 'aborted',
                ...(requestScope.userMessageId ? { userMessageId: requestScope.userMessageId } : {}),
                ...(requestScope.assistantMessageId ? { assistantMessageId: requestScope.assistantMessageId } : {}),
            } : {
                status: error instanceof ChatContextAdmissionError && !requestScope.userMessageId ? 'rejected' : 'failed',
                requestId,
                reason:
                    contextAdmissionFailureReason(error) ?? (error instanceof ToolIterationLimitError
                        ? 'tool_iteration_limit'
                        : 'stream_error'),
                error: message,
                ...(requestScope.userMessageId ? { userMessageId: requestScope.userMessageId } : {}),
                ...(requestScope.assistantMessageId ? { assistantMessageId: requestScope.assistantMessageId } : {}),
            };
            if (!stopped && import.meta.dev) {
                console.warn('[useChat] sendMessage threw', errorDiagnostics(error));
            }
            if (!stopped && !contextAdmissionFailureReason(error)) reportError(error, {
                severity: 'error',
                tags: { domain: 'chat', stage: 'send' },
                toast: true,
            });
        } finally {
            if (result.status !== 'detached') requestScope.abortController?.abort();
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
                    failureReason: 'reason' in result ? result.reason : undefined,
                });
                reportFinalization(finalization);
            }
            if (nativeRecoveryCandidates.shouldCleanup(requestScope, result)) await nativeRecoveryCandidates.cleanup(requestScope, result);
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
        const preparation = await prepareTurn(requestScope, contentOrParams, maybeParams);
        if (preparation.done) return preparation.result;
        const { content, sendMessagesParams, workspaceGeneration, toolDraftId, preparationSignal,
            newPromptSelection, outgoing, admissionThreadId, files, file_hashes, parts,
            persistedUserText, contextOmission } = preparation.turn;
        const { resolveChatProject, initialProjectId, projectAttachmentScope, projectExtractionScope } = preparation.project;
        const { chatToolPreferences } = preparation.model;
        const toolPreferenceKey = chatToolPreferenceKey(admissionThreadId);
        const { row: savedTools } = await getKvRecordByName(toolPreferenceKey, requestScope.originDb);
        if (!savedTools?.value) await setKvByName(toolPreferenceKey, JSON.stringify(chatToolPreferences), requestScope.originDb, {
            isValid: () => getDb() === requestScope.originDb && getWorkspaceGeneration() === workspaceGeneration && !isRequestCancelled(requestScope),
            ifClock: savedTools?.clock ?? null,
        });
        const accepted = await acceptUserTurn({ requestScope, content, outgoing, sendMessagesParams,
            admissionThreadId, newPromptSelection, toolDraftId, workspaceGeneration, preparationSignal,
            persistedUserText, parts, files, file_hashes, contextOmission, initialProjectId,
            projectAttachmentScope, projectExtractionScope, resolveChatProject }, {
            view: { messages, rawMessages }, threadIdRef, hooks, limits: runtimeConfig.public.limits,
            getActivePaneContext,
        });
        if ('result' in accepted) return accepted.result;
        const { userDbMsg, requestThreadId } = accepted;

        return await dispatchTurn(requestScope, preparation, userDbMsg, requestThreadId);
    }

    const prepareTurn = createTurnPreparation({
        view: { messages, rawMessages, threadIdRef, pendingPromptIdRef, abortController }, options, hooks, toast,
        defaultModel: DEFAULT_AI_MODEL, connected, allowUserOverride, effectiveApiKey, hasInstanceKey,
        guestAccessEnabled, backgroundStreamingAllowed, ssrAuthEnabled: () => runtimeConfig.public.ssrAuthEnabled === true,
        startLogin: () => { void openRouterAuth.startLogin(); }, taskPrompt: () => activePromptContent.value,
        enforceClientLimits, recoverNativeTurn: (...args) => recoverNativeTurn(...args),
        flushForSend: () => {
            if (tailAssistant.value && lastSuppressedAssistantId && tailAssistant.value.id === lastSuppressedAssistantId) {
                tailAssistant.value = null;
            } else {
                flushTailAssistant();
            }
            lastSuppressedAssistantId = null;
        },
    });
    const nativeRecoveryCandidates = createNativeRecoveryCandidates();
    const runPreparedNative = createNativeExecution({
        view: { rawMessages, tailAssistant, resolveUiMessage, threadIdRef, visibleRequest,
            abortController, loading, activeRequest: () => activeRequestScope, isDetached, resetStream,
            getActivePaneContext },
        background: { backgroundStreamingAllowed, serverNotificationsEnabled, backgroundJobId,
            backgroundJobMode, backgroundJobInfo, attachBackgroundJobToUi, ensureScopedBackgroundTracker,
            normalizeBackgroundToolCalls, notifyBackgroundAdmissionUncertain, logBgStream, warnBgStream },
        hooks, nativeRecoveryCandidates, effectiveApiKey, taskPrompt: () => activePromptContent.value,
        canonicalOutputLimitBytes, ownsCurrentView, reportFinalization, isStaleDevModuleError,
        warnDelegation: () => toast.add({ title: 'Keep this page open for delegated chats',
            description: 'If this response starts another chat, it needs this browser to stay open.',
            color: 'warning', duration: 8000 }),
    });

    const dispatchTurn = createTurnDispatch({
        view: { messages, rawMessages, tailAssistant, resolveUiMessage, visibleRequest, abortController,
            loading, streamId, aborted, detached, activeRequest: () => activeRequestScope, isDetached, resetStream },
        backgroundJobId, backgroundJobMode, backgroundJobInfo, workflowMessageScopes, hooks, toast,
        executeNative: runPreparedNative, reportFinalization, isStaleDevModuleError,
    });

    const recoverNativeTurn = createNativeRecovery({
        defaultModel: DEFAULT_AI_MODEL, forceForeground: options.forceForeground, excludedTools: options.excludedTools,
        backgroundAllowed: () => backgroundStreamingAllowed.value, taskPrompt: () => activePromptContent.value, hooks,
        onAdmitted: (requestScope, userId, assistantId, newStreamId) => {
            requestScope.streamId = newStreamId; streamId.value = newStreamId;
            rawMessages.value = rawMessages.value.filter(row => row.id !== assistantId);
            messages.value = messages.value.filter(row => row.id !== assistantId);
            if (tailAssistant.value?.id === assistantId) tailAssistant.value = null;
            publishRequest(requestScope, { status: 'streaming', requestId: requestScope.requestId,
                userMessageId: userId, assistantMessageId: assistantId });
        },
        execute: input => runPreparedNative(input),
    });


    // END sendMessage

    /**
     * Purpose:
     * Retries a prior turn by moving its user/assistant pair to the bottom.
     *
     * Behavior:
     * - Rebuilds message context from local state
     * - Reuses the current settings unless a model override is supplied
     * - `afterEdit`: the user prompt was just edited, which changes the turn's
     *   conversation fingerprint. A saved attempt for it can no longer be
     *   recovered, so it is discarded and a fresh request is built from the
     *   edited row instead.
     *
     * Constraints:
     * - No-op if message or thread context is missing
     */
    async function retryMessage(messageId: string, modelOverride?: string, options: { afterEdit?: boolean } = {}) {
        const retryRevision = navigationRevision;
        const retryDb = getDb(); const retryGeneration = getWorkspaceGeneration();
        if (threadIdRef.value) {
            const db = getDb(); const generation = getWorkspaceGeneration(); const threadId = threadIdRef.value;
            const checkpoint = await db.chat_request_recoveries.get(threadId);
            if (disposed || retryRevision !== navigationRevision || getDb() !== db || generation !== getWorkspaceGeneration() || threadIdRef.value !== threadId)
                return { status: 'rejected' as const, reason: 'unavailable' as const };
            if (options.afterEdit) {
                if (checkpoint?.user_message_id === messageId) {
                    await db.transaction('rw', db.chat_request_recoveries, async () => {
                        const saved = await db.chat_request_recoveries.get(threadId);
                        if (saved?.user_message_id === messageId) await db.chat_request_recoveries.delete(threadId);
                    });
                }
            } else if (checkpoint && [checkpoint.user_message_id, checkpoint.assistant_message_id].includes(messageId)) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A durable checkpoint can be written by a newer client.
                if (checkpoint.version !== 1)
                    return { status: 'rejected' as const, reason: 'unavailable' as const,
                        error: 'This saved attempt uses an unsupported recovery version. Update the app or edit the draft to prepare a new request.' };
                if (!await discardStaleRecovery(db, checkpoint))
                    return sendMessage({ ...checkpoint.input, model: modelOverride || checkpoint.input.model });
            }
        }
        const { retryMessageImpl } = await import('~/utils/chat/useAi-internal/retry');
        if (disposed || retryRevision !== navigationRevision || getDb() !== retryDb || getWorkspaceGeneration() !== retryGeneration)
            return { status: 'rejected' as const, reason: 'unavailable' as const };
        return await retryMessageImpl(
            {
                ownsView: () => !disposed && navigationRevision === retryRevision,
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
        const continuationGeneration = getWorkspaceGeneration();
        try {
            const { continueMessageImpl } = await import('~/utils/chat/useAi-internal/continue');
            if (isRequestCancelled(request) || getDb() !== request.originDb
                || getWorkspaceGeneration() !== continuationGeneration) return;
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
                    hasUserKey: computed(() => allowUserOverride.value && connected.value),
                    defaultModelId: DEFAULT_AI_MODEL,
                    getSystemPromptContent,
                    useAiSettings,
                    resolveContextPolicy: async (selectedModelId, signal) => {
                        const preference = await useAiSettings().captureContextPreference();
                        const model = await useModelStore().resolveContextModel(selectedModelId, { signal });
                        if (!model.ok) throw new ChatContextAdmissionError(model);
                        return Object.freeze({ model: model.metadata, source: model.source,
                            userMaxContextTokens: preference.maxContextTokens });
                    },
                    catalogModel: (selectedModelId) => {
                        const { catalog, favoriteModels } = useModelStore();
                        const id = openRouterCatalogLookupId(selectedModelId);
                        // Exact IDs win over aliases, as in send's context resolution.
                        return catalog.value.find((entry) => entry.id === id) ?? favoriteModels.value.find((entry) => entry.id === id)
                            ?? catalog.value.find((entry) => entry.canonical_slug === id)
                            ?? favoriteModels.value.find((entry) => entry.canonical_slug === id);
                    },
                    backgroundStreamingAllowed:
                        backgroundStreamingAllowed.value,
                    workspaceId: request.workspaceId,
                    userId: request.originUserId!,
                    onBackgroundAdmissionUncertain: () => {
                        if (request.ownsView()) notifyBackgroundAdmissionUncertain();
                    },
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
                                userId: request.originUserId!,
                                workspaceId: params.workspaceId,
                                canonicalHistory: true,
                                useSse: backgroundStreamingAllowed.value,
                                request,
                            });
                        }
                        return ensureScopedBackgroundTracker({
                            ...params,
                            userId: request.originUserId!,
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

        // A loaded seed skips the history reload, which is what reattaches
        // durable generations; reattach them as a new controller does.
        if (historyLoadedFor.value) await reattachBackgroundJobs();
        await ensureHistorySynced();
    }

    function clear() {
        const isBackgroundActive =
            backgroundStreamingAllowed.value &&
            (backgroundJobId.value || backgroundJobMode.value !== 'none');
        // Component disposal detaches the visible request before scope cleanup.
        // Its durable generation remains active after loading becomes false.
        const isForegroundStreamActive =
            Boolean(activeRequestScope && activeRequestScope.phase.value !== 'terminal') &&
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
                        errorDiagnostics(e)
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

    // Recovery reads browser-local storage. Direct chat routes also create this
    // controller during SSR, where IndexedDB is unavailable.
    if (typeof window !== 'undefined') {
        void reattachBackgroundJobs();
        // Seeded histories skip ensureHistorySynced, so recover abandoned
        // foreground generations on attach (e.g. refresh mid-stream).
        if (threadIdRef.value) {
            void reconcileForegroundGenerations().catch((error) => {
                if (import.meta.dev) {
                    console.warn('[useChat] attach-time recovery failed', errorDiagnostics(error));
                }
            });
        }
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
    function notifyBackgroundAdmissionUncertain(): void {
        toast.add({
            title: 'Response status unknown',
            description: 'The server may still be running this response. Wait for it to reconnect before sending again.',
            color: 'warning',
            duration: 8000,
        });
    }

    const backgroundStopsInFlight = new Set<string>();

    /**
     * Projects a confirmed stop into UI and durable state. Only call after the
     * server confirmed the job was aborted. Shared UI
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
            const aborted = await abortBackgroundJob(jobId, (state) => {
                logBgStream('abort-background-outcome', { jobId, state });
            });
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
            const result = await abortBackgroundAdmission(admissionId, scope?.workspaceId ?? continuation?.workspaceId);
            if (result.aborted && (!result.state || result.state === 'aborted')) {
                await markBackgroundStopped(scope ?? continuation ?? undefined);
                logBgStream('abort-admission-confirmed', {
                    admissionId,
                    aborted: result.aborted,
                    pending: result.pending,
                    jobId: result.jobId ?? null,
                });
                return true;
            }
            if (result.pending || result.state === 'cancel_requested') {
                logBgStream('abort-admission-requested', { admissionId, state: result.state, jobId: result.jobId });
                toast.add({
                    title: 'Stop requested',
                    description: 'Cancellation was recorded. The server has not confirmed that execution stopped.',
                    color: 'warning',
                    duration: 4000,
                });
                // Keep canonical history authoritative; a pending marker alone
                // must not finalize the assistant row as aborted.
                return false;
            }
            logBgStream('abort-admission-unconfirmed', { admissionId, state: result.state });
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
