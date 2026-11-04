import type { Ref } from 'vue';
import type { Or3DB } from '~/db/client';
import { getDb, getActiveWorkspaceId, getWorkspaceGeneration } from '~/db/client';
import { newId } from '~/db/util';
import { messagesByThread } from '~/db/messages';
import { createStreamAccumulator } from '~/composables/chat/useStreamAccumulator';
import { isStaleForegroundGeneration, remainingForegroundLeaseMs } from '~/utils/chat/generation-lease';
import { deriveMessageContent } from '~/utils/chat/messages';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { projectTranscriptForOpenRouter, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { createChatRequest, finalizeRequest, projectTerminalMessages, type ChatRequest, type RequestFinalization } from './requestController';
import type { StoredMessage } from './nativeExecutionTypes';
import type { createChatViewProjection } from './viewProjection';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import { presentError } from '~~/shared/errors';
import { reportError } from '~/utils/errors';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { DelegationDisplayActivitySchema } from '~~/shared/chat/delegation-checkpoint';
import { BackgroundTrackerConflict } from './background-tracker-conflict';
import { backgroundJobTrackers, primeBackgroundJobUpdate, stopBackgroundJobTracking,
    ensureBackgroundJobTracker, subscribeBackgroundJob } from './backgroundJobs';
import type { BackgroundJobSubscriber, BackgroundJobTracker, EnsureBackgroundJobTrackerParams } from './types';

export interface BackgroundAttachmentParams {
    jobId: string;
    userId: string;
    messageId: string;
    threadId: string;
    originDb?: Or3DB;
    workspaceId?: string;
    canonicalHistory?: boolean;
    generationId?: string;
    initialContent?: string;
    initialReasoning?: string;
    initialAttempt?: number;
    isReattach?: boolean;
    useSse?: boolean;
    request?: ChatRequest;
}

/** Coordinates view reattachment; trackers and request finalization remain authoritative. */
export function createBackgroundAttachmentCoordinator(ports: {
    view: Pick<ReturnType<typeof createChatViewProjection>, 'messages' | 'rawMessages' | 'tailAssistant'>;
    threadIdRef: Ref<string | undefined>;
    loading: Readonly<Ref<boolean>>;
    backgroundStreamingAllowed: Readonly<Ref<boolean>>;
    notificationUserId: Readonly<Ref<string>>;
    detached: Ref<boolean>;
    backgroundJobId: Ref<string | null>;
    backgroundJobMode: Ref<'none' | 'background'>;
    backgroundJobInfo: Ref<{ jobId: string; threadId: string; messageId: string } | null>;
    backgroundRequestScopes: Map<string, ChatRequest>;
    visibleRequest: Ref<ChatRequest | null>;
    serverNotificationsEnabled: Readonly<Ref<boolean>>;
    streamAcc: ReturnType<typeof createStreamAccumulator>;
    resolveUiMessage: ReturnType<typeof createChatViewProjection>['resolveUiMessage'];
    syncTailAccumulator: ReturnType<typeof createChatViewProjection>['syncTailAccumulator'];
    admitRequest: (kind: 'reattach', threadId: string, originDb: Or3DB, workspaceId: string) => ChatRequest;
    releaseBackgroundControls: (request: ChatRequest) => void;
    navigationRevision: () => number;
    disposed: () => boolean;
    reportFinalization: (result: RequestFinalization) => void;
    logBgStream: (stage: string, details?: Record<string, unknown>) => void;
    warnBgStream: (stage: string, details?: Record<string, unknown>) => void;
}) {
    const { messages, rawMessages, tailAssistant } = ports.view;
    const { threadIdRef, loading, backgroundStreamingAllowed, notificationUserId, detached,
        backgroundJobId, backgroundJobMode, backgroundJobInfo,
        reportFinalization, logBgStream, warnBgStream, backgroundRequestScopes, visibleRequest,
        serverNotificationsEnabled, streamAcc, resolveUiMessage, syncTailAccumulator,
        admitRequest, releaseBackgroundControls } = ports;
    const backgroundJobDisposers: Array<() => void> = [];
    const attachedBackgroundJobs = new Set<string>();
    const foregroundReconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
    function clearForegroundReconcileTimers(): void {
        for (const timer of foregroundReconcileTimers.values()) clearTimeout(timer);
        foregroundReconcileTimers.clear();
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
            const activity = DelegationDisplayActivitySchema.safeParse(call.delegation);
            return {
                id: call.id,
                name: call.name,
                runtime: call.runtime,
                status: mappedStatus,
                args: call.args,
                result: call.result,
                ...(call.name === DELEGATE_CHAT_TOOL && call.id && activity.success && activity.data.callId === call.id
                    ? { delegation: activity.data } : {}),
                ...(typeof call.text_offset === 'number' ? { text_offset: call.text_offset } : {}),
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
    function ensureScopedBackgroundTracker(params: EnsureBackgroundJobTrackerParams): BackgroundJobTracker {
        const tracker = ensureBackgroundJobTracker(params);
        if (tracker.jobId !== params.jobId || tracker.userId !== params.userId ||
            tracker.threadId !== params.threadId || tracker.messageId !== params.messageId ||
            (tracker.workspaceId && params.workspaceId && tracker.workspaceId !== params.workspaceId) ||
            (tracker.originDb && params.originDb && tracker.originDb !== params.originDb) ||
            (tracker.generationId && params.generationId && tracker.generationId !== params.generationId)) {
            throw new BackgroundTrackerConflict();
        }
        return tracker;
    }

    function attachBackgroundJobToUi(params: BackgroundAttachmentParams): BackgroundJobTracker {
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
        const tracker = ensureScopedBackgroundTracker({
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
        const attachmentRevision = ports.navigationRevision();
        request.ownsView = () =>
            backgroundRequestScopes.get(params.jobId) === request &&
            ports.navigationRevision() === attachmentRevision &&
            notificationUserId.value === params.userId &&
            (!tracker.userId || tracker.userId === params.userId) &&
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
            // Subscriber delivery and the completion promise can carry the
            // same terminal status. Claim/report it only once.
            if (request.finalization) {
                await request.finalization;
                return;
            }
            if (
                typeof update.status.attempt === 'number' &&
                typeof request.lastAttempt === 'number' &&
                update.status.attempt < request.lastAttempt
            )
                return;
            if (request.ownsView() && !update.canonicalFinalized) {
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
                      ? presentError(update.status.error, { code: 'ERR_STREAM_FAILURE' }).message
                      : null;
            if (outcome === 'failed' && request.ownsView()) reportError(update.status.error, {
                code: 'ERR_STREAM_FAILURE', tags: { domain: 'chat', stage: 'background' },
            });
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
                    canonicalFinalized: update.canonicalFinalized,
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
                onReconnecting: (reconnecting) => {
                    if (request.finalization || !request.ownsView()) return;
                    const target = resolveUiMessage(params.messageId);
                    if (!target || Boolean(target.reconnecting) === reconnecting) return;
                    target.reconnecting = reconnecting;
                    messages.value = [...messages.value];
                },
                onUpdate: ({ content, delta, replace, reasoning, reasoningReplace, status }) => {
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
                        (reasoning.length > 0 || reasoningReplace === true) &&
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
                        canonicalFinalized: status.canonicalFinalized,
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


    async function reconcileForegroundGenerations(): Promise<void> {
        const reconcileThreadId = threadIdRef.value;
        if (!reconcileThreadId) return;
        // Capture the workspace at admission: recovery must finalize rows in
        // the thread's own database even if the user navigates mid-reconcile.
        const reconcileDb = getDb();
        const reconcileWorkspaceId = getActiveWorkspaceId() ?? 'local';
        const reconcileRevision = ports.navigationRevision();
        const ownsReconcileView = () => !ports.disposed() &&
            ports.navigationRevision() === reconcileRevision &&
            getDb() === reconcileDb && threadIdRef.value === reconcileThreadId;
        const persisted = (await messagesByThread(reconcileThreadId)) as
            | StoredMessage[]
            | undefined;
        // Stale query results must never touch a newer thread's view.
        if (!ownsReconcileView()) return;
        const restoreSavedAssistant = (row: StoredMessage) => {
            if (!ownsReconcileView() || loading.value) return;
            const restored = projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript([row]))
                .find((message) => message.id === row.id);
            if (!restored) return;
            rawMessages.value = rawMessages.value.map((message) => message.id === row.id ? restored : message);
            messages.value = messages.value.map((message) => message.id === row.id
                ? { ...message, ...ensureUiMessage(restored) } : message);
        };
        for (const row of persisted ?? []) {
            const rowData = row.data as Record<string, unknown> | null;
            if (row.role === 'assistant' && row.pending !== true) {
                const visible = messages.value.find((message) => message.id === row.id);
                if (visible?.pending)
                    restoreSavedAssistant(row);
            }
            if (
                row.role !== 'assistant' ||
                row.pending !== true ||
                typeof rowData?.background_job_id === 'string'
            )
                continue;

            const interrupt = async () => {
                if (!ownsReconcileView()) return;
                foregroundReconcileTimers.delete(row.id);
                const latest = (await reconcileDb.messages.get(row.id)) as
                    | StoredMessage
                    | undefined;
                if (!latest) return;
                if (
                    latest.role === 'assistant' &&
                    latest.pending === true &&
                    typeof latest.data?.background_job_id !== 'string' &&
                    !isStaleForegroundGeneration(latest)
                ) {
                    // Another tab renewed the lease after this check was
                    // scheduled. Keep watching until it settles or expires.
                    if (!ports.disposed()) scheduleCheck(remainingForegroundLeaseMs(latest));
                    return;
                }
                if (!ownsReconcileView()) return;
                if (latest.pending !== true) {
                    restoreSavedAssistant(latest);
                    return;
                }
                if (typeof latest.data?.background_job_id === 'string') {
                    await reattachBackgroundJobs();
                    return;
                }
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
                    recovery.ownsView = ownsReconcileView;
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
                if (!ownsReconcileView()) return;
                const terminalError =
                    latest.error ??
                    (finalizedHere ? 'stream_interrupted' : undefined);
                if (terminalError === undefined) return;
                // The captured row is pending; successful finalization retires it.
                const leftPending = !finalizedHere;
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

            const scheduleCheck = (delay: number) => {
                if (!ownsReconcileView()) return;
                // Admission can finish on the server after a reload but before
                // this tab receives its job ID. Check that gap promptly instead
                // of leaving an empty row for the foreground lease duration.
                const admissionDelay = rowData?.generation_mode === 'background'
                    && typeof rowData.background_admission_id === 'string' ? Math.min(delay, 1000) : delay;
                const timer = setTimeout(() => void interrupt(), admissionDelay);
                foregroundReconcileTimers.set(row.id, timer);
            };

            const remaining = remainingForegroundLeaseMs(row);
            if (remaining === 0 || isStaleForegroundGeneration(row)) {
                await interrupt();
                if (threadIdRef.value !== reconcileThreadId) return;
            } else if (!foregroundReconcileTimers.has(row.id)) {
                scheduleCheck(remaining);
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
        const reattachWorkspaceGeneration = getWorkspaceGeneration();
        const reattachUserId = notificationUserId.value;
        const reattachRevision = ports.navigationRevision();
        const ownsReattach = () =>
            !ports.disposed() && backgroundStreamingAllowed.value &&
            ports.navigationRevision() === reattachRevision &&
            threadIdRef.value === reattachThreadId &&
            getDb() === reattachDb &&
            (getActiveWorkspaceId() ?? 'local') === reattachWorkspaceId &&
            getWorkspaceGeneration() === reattachWorkspaceGeneration &&
            notificationUserId.value === reattachUserId;
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
                    userId: reattachUserId,
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


    return { reconcileForegroundGenerations, reattachBackgroundJobs, clearForegroundReconcileTimers,
        clearBackgroundJobSubscriptions, attachBackgroundJobToUi, ensureScopedBackgroundTracker,
        normalizeBackgroundToolCalls, attachedCount: () => attachedBackgroundJobs.size };
}
