/**
 * @module server/api/jobs/[id]/stream.get
 *
 * Purpose:
 * Provides a Server-Sent Events (SSE) stream for real-time background job updates.
 *
 * Responsibilities:
 * - Establishes persistent connection.
 * - Subscribes to live job updates (if active) or falls back to polling (if idle/persisted).
 * - Implements "smart polling" (adaptive intervals).
 * - Handles client disconnects.
 */
import type { BackgroundJob } from '../../../utils/background-jobs/types';
import { shouldResetBackgroundContent } from '../../../utils/background-jobs/recovery';
import { requireJobWorkspaceAccess } from '../../../utils/background-jobs/access';
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import {
    getJobLiveState,
    registerJobReconciler,
    registerJobStream,
    registerJobViewer,
} from '../../../utils/background-jobs/viewers';

function logBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function warnBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

type StreamEventPayload = {
    event: 'snapshot' | 'delta' | 'status';
    status: {
        id: string;
        status: BackgroundJob['status'];
        threadId: string;
        messageId: string;
        model: string;
        chunksReceived: number;
        attempt?: number;
        startedAt: number;
        completedAt?: number;
        error?: string;
        content?: string;
        content_delta?: string;
        content_length?: number;
        content_reset?: boolean;
        reasoning_text?: string;
        reasoning_delta?: string;
        reasoning_length?: number;
        reasoning_reset?: boolean;
        tool_calls?: BackgroundJob['tool_calls'];
        workflow_state?: BackgroundJob['workflow_state'];
    };
};

const KEEPALIVE_INTERVAL_MS = 15_000;
// Workflow execution state includes completed node outputs so a viewer can
// follow multi-agent runs. Keep enough headroom for several concurrent drafts
// before treating a client as too slow to keep up.
export const MAX_SSE_VIEWER_QUEUE_BYTES = 1024 * 1024;

export function hasSseQueueCapacity(
    availableBytes: number | null,
    eventBytes: number
): boolean {
    return availableBytes === null || availableBytes >= eventBytes;
}

export function workflowStateVersionOf(
    state: BackgroundJob['workflow_state']
): number {
    const version = state?.version;
    return typeof version === 'number' && Number.isFinite(version)
        ? version
        : -1;
}

export function hasWorkflowStateAdvanced(
    lastVersion: number,
    state: BackgroundJob['workflow_state']
): boolean {
    return workflowStateVersionOf(state) > lastVersion;
}

export function serializeJobStatus(
    job: BackgroundJob,
    overrides?: {
        content?: string;
        content_delta?: string;
        content_length?: number;
        includeContent?: boolean;
        reasoning_text?: string;
        reasoning_delta?: string;
        reasoning_length?: number;
        reasoning_reset?: boolean;
        tool_calls?: BackgroundJob['tool_calls'];
        workflow_state?: BackgroundJob['workflow_state'];
        content_reset?: boolean;
    }
): StreamEventPayload['status'] {
    const includeContent = overrides?.includeContent !== false;
    const contentOverride = overrides?.content;
    const status: StreamEventPayload['status'] = {
        id: job.id,
        status: job.status,
        threadId: job.threadId,
        messageId: job.messageId,
        model: job.model,
        chunksReceived: job.chunksReceived,
        attempt: job.attempts ?? 0,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        tool_calls: overrides?.tool_calls ?? job.tool_calls,
        workflow_state: overrides?.workflow_state ?? job.workflow_state,
        content_reset: overrides?.content_reset,
        content_delta: overrides?.content_delta,
        content_length:
            typeof overrides?.content_length === 'number'
                ? overrides.content_length
                : job.content.length,
        reasoning_delta: overrides?.reasoning_delta,
        reasoning_length:
            typeof overrides?.reasoning_length === 'number'
                ? overrides.reasoning_length
                : (job.reasoning).length,
        reasoning_reset: overrides?.reasoning_reset,
    };

    if (includeContent) {
        status.content =
            typeof contentOverride === 'string' ? contentOverride : job.content;
        status.reasoning_text =
            typeof overrides?.reasoning_text === 'string'
                ? overrides.reasoning_text
                : (job.reasoning);
    } else if (typeof contentOverride === 'string') {
        status.content = contentOverride;
    }

    return status;
}

/**
 * GET /api/jobs/:id/stream
 *
 * Purpose:
 * Real-time feed of background generation.
 *
 * Behavior:
 * 1. Sends initial 'snapshot' (full state or delta from `offset`).
 * 2. If 'streaming': Attaches listener to in-memory `JobStream`. Pushes 'delta' events.
 * 3. Falls back to DB polling if memory stream is gone but job is incomplete.
 * 4. Closing: Ends stream on completion or error.
 *
 * Security:
 * - Content-Type: text/event-stream
 * - No-Cache
 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, 'id');

    if (!jobId) {
        warnBgStream('jobs-stream-missing-job-id', {});
        setResponseStatus(event, 400);
        return { error: 'Missing job ID' };
    }

    // Resolve user ID for authorization
    let userId: string | null = null;
    let session: Awaited<ReturnType<typeof resolveSessionContext>> | null = null;
    if (isSsrAuthEnabled(event)) {
        session = await resolveSessionContext(event);
        if (session.authenticated && session.user?.id) {
            userId = session.user.id;
        }
    }

    if (!userId) {
        warnBgStream('jobs-stream-auth-required', {
            jobId,
        });
        setResponseStatus(event, 401);
        return { error: 'Authentication required' };
    }

    const provider = await getJobProvider();
    const initialJob = await provider.getJob(jobId, userId);

    if (!initialJob) {
        warnBgStream('jobs-stream-job-not-found', {
            jobId,
            userId,
        });
        setResponseStatus(event, 404);
        return { error: 'Job not found or unauthorized' };
    }

    await requireJobWorkspaceAccess(event, session, initialJob.execution?.workspaceId, 'workspace.read');

    const query = getQuery(event);
    const offsetParam = typeof query.offset === 'string' ? query.offset : null;
    const offset = offsetParam ? Number(offsetParam) : null;
    const attemptParam =
        typeof query.attempt === 'string' ? Number(query.attempt) : null;
    const attemptChanged = shouldResetBackgroundContent(
        attemptParam,
        initialJob.attempts ?? 0,
        offset
    );
    const initialOffset =
        !attemptChanged &&
        typeof offset === 'number' && Number.isFinite(offset) && offset >= 0
            ? Math.min(offset, initialJob.content.length)
            : 0;
    logBgStream('jobs-stream-request', {
        jobId,
        userId,
        initialStatus: initialJob.status,
        initialContentLength: initialJob.content.length,
        requestedOffset: offset,
        effectiveOffset: initialOffset,
    });

    setHeader(event, 'Content-Type', 'text/event-stream');
    setHeader(event, 'Cache-Control', 'no-cache, no-transform');
    setHeader(event, 'Connection', 'keep-alive');

    const encoder = new TextEncoder();

    let cancelActiveStream: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            let closed = false;
            let lastContentLength = initialOffset;
            let lastReasoningLength = attemptChanged
                ? 0
                : (initialJob.reasoning).length;
            let lastStatus: BackgroundJob['status'] = initialJob.status;
            let lastToolCalls = JSON.stringify(initialJob.tool_calls);
            let lastWorkflowVersion = workflowStateVersionOf(
                initialJob.workflow_state
            );
            let lastAttempt =
                typeof attemptParam === 'number' && Number.isFinite(attemptParam)
                    ? attemptParam
                    : initialJob.attempts ?? 0;
            const disposeViewer = registerJobViewer(jobId);
            logBgStream('jobs-stream-viewer-registered', {
                jobId,
                userId,
                initialStatus: initialJob.status,
            });
            let disposeLive: (() => void) | null = null;
            let disposeReconciler: (() => void) | null = null;
            let keepAlive: ReturnType<typeof setInterval> | null = null;
            const isClosed = () => closed;
            let clearPendingUpdates = () => {};

            const closeStream = (reason: string) => {
                if (isClosed()) return;
                closed = true;
                clearPendingUpdates();
                logBgStream('jobs-stream-close', {
                    jobId,
                    userId,
                    reason,
                    lastStatus,
                    lastContentLength,
                });
                try {
                    controller.close();
                } catch {
                    /* intentionally empty */
                }
                if (disposeLive) {
                    disposeLive();
                    disposeLive = null;
                }
                if (disposeReconciler) {
                    disposeReconciler();
                    disposeReconciler = null;
                }
                if (keepAlive) {
                    clearInterval(keepAlive);
                    keepAlive = null;
                }
                disposeViewer();
            };
            cancelActiveStream = () => closeStream('consumer_cancel');

            event.node.req.on('close', () => {
                closeStream('client_disconnect');
            });

            const write = (payload: StreamEventPayload) => {
                if (isClosed()) return;
                const deltaLength =
                    typeof payload.status.content_delta === 'string'
                        ? payload.status.content_delta.length
                        : 0;
                const shouldLogWrite =
                    payload.event !== 'delta' ||
                    payload.status.status !== 'streaming' ||
                    deltaLength >= 256;
                if (shouldLogWrite) {
                    logBgStream('jobs-stream-write', {
                        jobId,
                        userId,
                        event: payload.event,
                        status: payload.status.status,
                        contentLengthHint:
                            typeof payload.status.content_length === 'number'
                                ? payload.status.content_length
                                : null,
                        deltaLength,
                        includesContent:
                            typeof payload.status.content === 'string',
                    });
                }
                const encoded = encoder.encode(
                    `data: ${JSON.stringify(payload)}\n\n`
                );
                const available = controller.desiredSize;
                if (!hasSseQueueCapacity(available, encoded.byteLength)) {
                    warnBgStream('jobs-stream-slow-consumer', {
                        jobId,
                        userId,
                        resumeOffset: lastContentLength,
                        eventBytes: encoded.byteLength,
                    });
                    closeStream(`slow_consumer_offset_${lastContentLength}`);
                    return;
                }
                controller.enqueue(encoded);
            };

            // Send initial snapshot
            if (initialOffset === 0) {
                write({
                    event: 'snapshot',
                    status: serializeJobStatus(initialJob, {
                        content: initialJob.content,
                        content_length: initialJob.content.length,
                        content_reset: attemptChanged || undefined,
                        reasoning_text: initialJob.reasoning,
                        reasoning_length: (initialJob.reasoning).length,
                        reasoning_reset: attemptChanged || undefined,
                    }),
                });
            } else {
                const initialDelta = initialJob.content.slice(initialOffset);
                write({
                    event: 'snapshot',
                    status: serializeJobStatus(initialJob, {
                        content_delta: initialDelta,
                        includeContent: false,
                        content_length: initialJob.content.length,
                        reasoning_text: initialJob.reasoning,
                        reasoning_length: (initialJob.reasoning).length,
                    }),
                });
            }
            lastContentLength = initialJob.content.length;
            lastReasoningLength = (initialJob.reasoning).length;

            const onLiveEvent: Parameters<typeof registerJobStream>[1] = (
                liveEvent
            ) => {
                if (
                    isClosed() ||
                    (liveEvent.attempt !== undefined &&
                        liveEvent.attempt < lastAttempt)
                )
                    return;
                const deltaLength =
                    liveEvent.type === 'delta'
                        ? liveEvent.content_delta.length
                        : 0;
                const shouldLogLiveEvent =
                    liveEvent.type !== 'delta' || deltaLength >= 256;
                if (shouldLogLiveEvent) {
                    logBgStream('jobs-stream-live-event', {
                        jobId,
                        userId,
                        type: liveEvent.type,
                        status:
                            liveEvent.type === 'status'
                                ? liveEvent.status
                                : 'streaming',
                        contentLength: liveEvent.content_length,
                        deltaLength,
                    });
                }
                if (liveEvent.type === 'delta') {
                    const reasoningDelta =
                        typeof liveEvent.reasoning_delta === 'string'
                            ? liveEvent.reasoning_delta
                            : '';
                    const reasoningLength =
                        typeof liveEvent.reasoning_length === 'number'
                            ? liveEvent.reasoning_length
                            : lastReasoningLength;
                    const hasContentDelta =
                        liveEvent.content_delta.length > 0 &&
                        liveEvent.content_length > lastContentLength;
                    const hasReasoningDelta =
                        reasoningDelta.length > 0 &&
                        reasoningLength > lastReasoningLength;
                    const toolCalls = JSON.stringify(
                        liveEvent.tool_calls ?? initialJob.tool_calls
                    );
                    const hasStateChange =
                        toolCalls !== lastToolCalls ||
                        hasWorkflowStateAdvanced(
                            lastWorkflowVersion,
                            liveEvent.workflow_state
                        );
                    if (
                        !hasContentDelta &&
                        !hasReasoningDelta &&
                        !hasStateChange
                    )
                        return;
                    lastToolCalls = toolCalls;
                    const previousContentLength = lastContentLength;
                    const previousReasoningLength = lastReasoningLength;
                    if (liveEvent.attempt !== undefined)
                        lastAttempt = liveEvent.attempt;
                    if (hasContentDelta)
                        lastContentLength = liveEvent.content_length;
                    if (hasReasoningDelta) {
                        lastReasoningLength = reasoningLength;
                    }
                    lastStatus = 'streaming';
                    lastWorkflowVersion = Math.max(
                        lastWorkflowVersion,
                        workflowStateVersionOf(liveEvent.workflow_state)
                    );
                    write({
                        event: 'delta',
                        status: serializeJobStatus(
                            {
                                ...initialJob,
                                status: 'streaming',
                                chunksReceived: liveEvent.chunksReceived,
                                attempts:
                                    liveEvent.attempt ??
                                    initialJob.attempts,
                                tool_calls:
                                    liveEvent.tool_calls ??
                                    initialJob.tool_calls,
                                workflow_state:
                                    liveEvent.workflow_state ??
                                    initialJob.workflow_state,
                            },
                            {
                                includeContent: false,
                                content_delta: hasContentDelta
                                    ? liveEvent.content_delta.slice(
                                          -Math.min(
                                              liveEvent.content_delta
                                                  .length,
                                              liveEvent.content_length -
                                                  previousContentLength
                                          )
                                      )
                                    : undefined,
                                content_length: lastContentLength,
                                reasoning_delta: hasReasoningDelta
                                    ? reasoningDelta.slice(
                                          -Math.min(
                                              reasoningDelta.length,
                                              reasoningLength -
                                                  previousReasoningLength
                                          )
                                      )
                                    : undefined,
                                reasoning_length: lastReasoningLength,
                                tool_calls: liveEvent.tool_calls,
                                workflow_state: liveEvent.workflow_state,
                            }
                        ),
                    });
                    return;
                }
                lastToolCalls = JSON.stringify(
                    liveEvent.tool_calls ?? initialJob.tool_calls
                );
                lastStatus = liveEvent.status;
                lastContentLength = liveEvent.content_length;
                lastReasoningLength =
                    liveEvent.reasoning_length ??
                    (liveEvent.reasoning ?? '').length;
                lastWorkflowVersion =
                    liveEvent.content_reset ||
                    liveEvent.attempt !== lastAttempt
                        ? workflowStateVersionOf(liveEvent.workflow_state)
                        : Math.max(
                              lastWorkflowVersion,
                              workflowStateVersionOf(
                                  liveEvent.workflow_state
                              )
                          );
                if (typeof liveEvent.attempt === 'number') {
                    lastAttempt = liveEvent.attempt;
                }
                write({
                    event: 'status',
                    status: serializeJobStatus(
                        {
                            ...initialJob,
                            status: liveEvent.status,
                            chunksReceived: liveEvent.chunksReceived,
                            completedAt: liveEvent.completedAt,
                            error: liveEvent.error,
                            content: liveEvent.content,
                            attempts:
                                liveEvent.attempt ?? initialJob.attempts,
                            tool_calls:
                                liveEvent.tool_calls ??
                                initialJob.tool_calls,
                            workflow_state:
                                liveEvent.workflow_state ??
                                initialJob.workflow_state,
                        },
                        {
                            includeContent: true,
                            content: liveEvent.content,
                            content_length: liveEvent.content_length,
                            reasoning_text:
                                liveEvent.reasoning ?? initialJob.reasoning,
                            reasoning_length:
                                liveEvent.reasoning_length ??
                                (
                                    liveEvent.reasoning ??
                                    initialJob.reasoning
                                ).length,
                            tool_calls: liveEvent.tool_calls,
                            workflow_state: liveEvent.workflow_state,
                            content_reset: liveEvent.content_reset,
                            reasoning_reset:
                                liveEvent.content_reset === true
                                    ? true
                                    : undefined,
                        }
                    ),
                });
                if (liveEvent.status !== 'streaming') {
                    closeStream('live_terminal_status');
                }
            };

            const onReconciledJob: Parameters<
                typeof registerJobReconciler
            >[2] = (job, pollError) => {
                if (isClosed()) return;
                if (pollError) {
                    // A failed provider lookup is a transport/reconciliation
                    // problem, not an authoritative generation failure.
                    // Close the SSE viewer so the client falls back to
                    // polling and retries; never fabricate a terminal
                    // `error` job status here.
                    warnBgStream('jobs-stream-reconcile-error', {
                        jobId,
                        userId,
                        error: pollError.message || 'Stream error',
                    });
                    closeStream('reconcile_error');
                    return;
                }
                if (!job) {
                    // Same rule: a missing snapshot may be a transient
                    // provider/read failure. Let the client polling path
                    // decide with bounded retries and reconciliation.
                    warnBgStream('jobs-stream-reconcile-job-missing', {
                        jobId,
                        userId,
                    });
                    closeStream('reconcile_job_missing');
                    return;
                }

                if ((job.attempts ?? 0) < lastAttempt) return;
                const attemptChanged = (job.attempts ?? 0) !== lastAttempt;
                const hasNewContent =
                    job.content.length > lastContentLength;
                const jobReasoning = job.reasoning;
                const hasNewReasoning =
                    jobReasoning.length > lastReasoningLength;
                const statusChanged = job.status !== lastStatus;
                const workflowStateAdvanced = hasWorkflowStateAdvanced(
                    lastWorkflowVersion,
                    job.workflow_state
                );
                const deltaLength = hasNewContent
                    ? job.content.length - lastContentLength
                    : 0;
                const shouldLogPollTick =
                    statusChanged ||
                    attemptChanged ||
                    job.status !== 'streaming' ||
                    deltaLength >= 256;
                if (shouldLogPollTick) {
                    logBgStream('jobs-stream-poll-tick', {
                        jobId,
                        userId,
                        polledStatus: job.status,
                        polledContentLength: job.content.length,
                        hasNewContent,
                        attemptChanged,
                        statusChanged,
                        deltaLength,
                    });
                }

                if (job.status !== 'streaming') {
                    // Always publish the canonical terminal snapshot, even when
                    // persisted progress overtakes queued live deltas.
                    write({
                        event: 'status',
                        status: serializeJobStatus(job, {
                            content_reset: attemptChanged || undefined,
                            reasoning_reset: attemptChanged || undefined,
                        }),
                    });
                    closeStream('reconcile_terminal_status');
                    return;
                }
                if (attemptChanged) {
                    // A recovered OpenRouter iteration starts from its
                    // durable checkpoint. Replace the client projection in
                    // full even if the regenerated text is already longer
                    // than the pre-restart partial response.
                    lastContentLength = job.content.length;
                    lastReasoningLength = jobReasoning.length;
                    write({
                        event: 'status',
                        status: serializeJobStatus(job, {
                            content: job.content,
                            includeContent: true,
                            content_length: job.content.length,
                            content_reset: true,
                            reasoning_text: jobReasoning,
                            reasoning_length: jobReasoning.length,
                            reasoning_reset: true,
                        }),
                    });
                } else if (hasNewContent) {
                    const delta = job.content.slice(lastContentLength);
                    const reasoningDelta = hasNewReasoning
                        ? jobReasoning.slice(lastReasoningLength)
                        : undefined;
                    lastContentLength = job.content.length;
                    if (hasNewReasoning) {
                        lastReasoningLength = jobReasoning.length;
                    }
                    write({
                        event: 'delta',
                        status: serializeJobStatus(job, {
                            includeContent: false,
                            content_delta: delta,
                            content_length: job.content.length,
                            reasoning_delta: reasoningDelta,
                            reasoning_length: jobReasoning.length,
                        }),
                    });
                } else if (hasNewReasoning) {
                    const reasoningDelta =
                        jobReasoning.slice(lastReasoningLength);
                    lastReasoningLength = jobReasoning.length;
                    write({
                        event: 'delta',
                        status: serializeJobStatus(job, {
                            includeContent: false,
                            content_length: job.content.length,
                            reasoning_delta: reasoningDelta,
                            reasoning_length: jobReasoning.length,
                        }),
                    });
                } else if (statusChanged) {
                    // Status change without new content
                    write({
                        event: 'status',
                        status: serializeJobStatus(job, {
                            includeContent: false,
                            content_length: job.content.length,
                            reasoning_text: jobReasoning,
                            reasoning_length: jobReasoning.length,
                        }),
                    });
                } else if (workflowStateAdvanced) {
                    // Node lifecycle and reasoning updates may advance while
                    // final workflow content is still empty. Project those
                    // state-only changes instead of waiting for text.
                    write({
                        event: 'status',
                        status: serializeJobStatus(job, {
                            includeContent: false,
                            content_length: job.content.length,
                        }),
                    });
                }

                lastWorkflowVersion = attemptChanged
                    ? workflowStateVersionOf(job.workflow_state)
                    : Math.max(lastWorkflowVersion, workflowStateVersionOf(job.workflow_state));
                if (attemptChanged || hasNewContent || hasNewReasoning || statusChanged || workflowStateAdvanced) {
                    lastToolCalls = JSON.stringify(job.tool_calls);
                }

                lastStatus = job.status;
                lastAttempt = job.attempts ?? 0;
            };
            // Freeze each batch before its fresh check. Later arrivals stay pending.
            // Coalescing adjacent deltas bounds event overhead without losing fences.
            let pending: QueuedUpdate[] = [];
            let activeBatch: QueuedUpdate[] = [];
            let pendingBytes = 0;
            let activeBytes = 0;
            let draining = false;
            clearPendingUpdates = () => {
                pending.length = 0;
                activeBatch.length = 0;
                pendingBytes = activeBytes = 0;
            };
            const drainUpdates = async () => {
                try {
                    while (!isClosed() && pending.length > 0) {
                        activeBatch = pending;
                        activeBytes = pendingBytes;
                        pending = [];
                        pendingBytes = 0;
                        await requireJobWorkspaceAccess(
                            event,
                            session,
                            initialJob.execution?.workspaceId,
                            'workspace.read'
                        );
                        if (isClosed()) return;
                        for (const update of activeBatch) {
                            if (isClosed()) break;
                            if (update.kind === 'live')
                                onLiveEvent(update.live);
                            else onReconciledJob(update.job);
                        }
                        activeBatch = [];
                        activeBytes = 0;
                    }
                } catch {
                    closeStream('stream_access_denied');
                } finally {
                    draining = false;
                }
            };
            const enqueueUpdate = (update: StreamUpdate) => {
                if (isClosed()) return;
                if (terminalState(update) !== null && (
                    pending.some((queued) =>
                        sameTerminalSnapshot(queued, update)
                    ) ||
                    activeBatch.some((queued) =>
                        sameTerminalSnapshot(queued, update)
                    )
                ))
                    return;
                const tail = pending.at(-1);
                const next = queuedUpdate(update, encoder);
                if (tail?.kind === 'live' && next.kind === 'live') {
                    if (
                        tail.live.type === 'delta' &&
                        next.live.type === 'delta' &&
                        canCoalesceDeltas(tail.live, next.live) &&
                        tail.metadata === next.metadata
                    ) {
                        pendingBytes -= tail.bytes;
                        next.live = {
                            ...next.live,
                            content_delta:
                                tail.live.content_delta +
                                next.live.content_delta,
                            reasoning_delta:
                                (tail.live.reasoning_delta ?? '') +
                                (next.live.reasoning_delta ?? ''),
                        };
                        next.deltaBytes += tail.deltaBytes;
                        next.bytes =
                            deltaMetadataBytes(next.live, encoder) +
                            next.deltaBytes;
                        pending.pop();
                    } else if (
                        next.live.type === 'status' &&
                        next.live.status !== 'streaming' &&
                        tail.live.type === 'delta' &&
                        next.live.attempt === tail.live.attempt &&
                        next.live.content_length >=
                            tail.live.content_length &&
                        (next.live.reasoning_length ?? 0) >=
                            (tail.live.reasoning_length ?? 0)
                    ) {
                        // The terminal supplies full text/reasoning. Retain an adjacent
                        // metadata transition, but reclaim its superseded text bytes.
                        pendingBytes -= tail.bytes;
                        pending.pop();
                        if (next.metadata !== tail.metadata) {
                            const stateOnly = queuedUpdate(
                                {
                                    kind: 'live',
                                    live: {
                                        ...tail.live,
                                        content_delta: '',
                                        reasoning_delta: '',
                                    },
                                },
                                encoder
                            );
                            pending.push(stateOnly);
                            pendingBytes += stateOnly.bytes;
                        }
                    }
                }
                if (
                    !hasSseQueueCapacity(
                        MAX_SSE_VIEWER_QUEUE_BYTES -
                            activeBytes -
                            pendingBytes,
                        next.bytes
                    )
                ) {
                    closeStream('live_authorization_queue_full');
                    return;
                }
                pending.push(next);
                pendingBytes += next.bytes;
                if (!draining) {
                    draining = true;
                    void Promise.resolve().then(drainUpdates);
                }
            };

            if (initialJob.status === 'streaming') {
                disposeLive = registerJobStream(jobId, (liveEvent) => {
                    const liveState = getJobLiveState(jobId);
                    const frozen = structuredClone({
                        ...liveEvent,
                        attempt:
                            liveEvent.attempt ??
                            liveState?.attempt ??
                            initialJob.attempts ??
                            0,
                        tool_calls:
                            liveEvent.tool_calls ?? liveState?.tool_calls,
                        workflow_state:
                            liveEvent.workflow_state ??
                            liveState?.workflow_state,
                        ...(liveEvent.type === 'status'
                            ? {
                                  reasoning:
                                      liveEvent.reasoning ??
                                      liveState?.reasoning ??
                                      initialJob.reasoning,
                              }
                            : {}),
                    });
                    enqueueUpdate({ kind: 'live', live: frozen });
                });
                const liveState = getJobLiveState(jobId);
                if (
                    liveState &&
                    (liveState.content.length > lastContentLength ||
                        liveState.reasoning.length > lastReasoningLength ||
                        hasWorkflowStateAdvanced(
                            lastWorkflowVersion,
                            liveState.workflow_state
                        ))
                ) {
                    enqueueUpdate({
                        kind: 'live',
                        live: structuredClone({
                            type: 'status',
                            status: liveState.status,
                            content: liveState.content,
                            content_length: liveState.content.length,
                            reasoning: liveState.reasoning,
                            reasoning_length: liveState.reasoning.length,
                            chunksReceived: liveState.chunksReceived,
                            completedAt: liveState.completedAt,
                            error: liveState.error,
                            attempt:
                                liveState.attempt ??
                                initialJob.attempts ??
                                0,
                            tool_calls: liveState.tool_calls,
                            workflow_state: liveState.workflow_state,
                        }),
                    });
                }
            }

            keepAlive = setInterval(() => {
                if (isClosed()) return;
                const ping = encoder.encode(': ping\n\n');
                const available = controller.desiredSize;
                if (!hasSseQueueCapacity(available, ping.byteLength)) {
                    closeStream(
                        `slow_consumer_offset_${lastContentLength}`
                    );
                    return;
                }
                controller.enqueue(ping);
            }, KEEPALIVE_INTERVAL_MS);

            disposeReconciler = registerJobReconciler(
                jobId,
                () => provider.getJob(jobId, userId),
                (job, pollError) => {
                    if (pollError || !job) {
                        onReconciledJob(job, pollError);
                        return;
                    }
                    if (
                        job.execution?.workspaceId !==
                        initialJob.execution?.workspaceId
                    ) {
                        closeStream('reconcile_workspace_changed');
                        return;
                    }
                    enqueueUpdate({
                        kind: 'snapshot',
                        job: structuredClone(job),
                    });
                }
            );
        },
        cancel() {
            cancelActiveStream?.();
        },
    }, {
        highWaterMark: MAX_SSE_VIEWER_QUEUE_BYTES,
        size: (chunk) => chunk.byteLength,
    });

    return sendStream(event, stream);
});

type LiveEvent = Parameters<typeof registerJobStream>[1] extends (
    event: infer E
) => void
    ? E
    : never;
type StreamUpdate =
    | { kind: 'live'; live: LiveEvent }
    | { kind: 'snapshot'; job: BackgroundJob };
type QueuedUpdate = StreamUpdate & {
    bytes: number;
    deltaBytes: number;
    metadata: string;
};

function deltaMetadataBytes(live: LiveEvent, encoder: TextEncoder): number {
    return encoder.encode(
        JSON.stringify({ ...live, content_delta: '', reasoning_delta: '' })
    ).byteLength;
}

function queuedUpdate(
    update: StreamUpdate,
    encoder: TextEncoder
): QueuedUpdate {
    if (update.kind === 'snapshot')
        return {
            ...update,
            bytes: encoder.encode(JSON.stringify(update.job)).byteLength,
            deltaBytes: 0,
            metadata: '',
        };
    const live = update.live;
    const metadata = JSON.stringify([
        live.attempt,
        live.tool_calls,
        live.workflow_state,
    ]);
    const deltaBytes =
        live.type === 'delta'
            ? encoder.encode(JSON.stringify(live.content_delta)).byteLength -
              2 +
              encoder.encode(JSON.stringify(live.reasoning_delta ?? ''))
                  .byteLength -
              2
            : 0;
    return {
        ...update,
        metadata,
        deltaBytes,
        bytes:
            live.type === 'delta'
                ? deltaMetadataBytes(live, encoder) + deltaBytes
                : encoder.encode(JSON.stringify(live)).byteLength,
    };
}

function canCoalesceDeltas(left: LiveEvent, right: LiveEvent): boolean {
    return (
        left.type === 'delta' &&
        right.type === 'delta' &&
        left.attempt === right.attempt &&
        left.content_length ===
            right.content_length - right.content_delta.length &&
        (left.reasoning_length ?? 0) ===
            (right.reasoning_length ?? 0) - (right.reasoning_delta?.length ?? 0)
    );
}

// Reconciliation and live delivery can report the same full terminal while a
// fresh lookup is pending. One frozen, authorized delivery covers that duplicate.
function sameTerminalSnapshot(
    left: StreamUpdate,
    right: StreamUpdate
): boolean {
    const a = terminalState(left);
    const b = terminalState(right);
    return (
        a !== null &&
        b !== null &&
        a.status === b.status &&
        a.attempt === b.attempt &&
        a.content === b.content &&
        a.reasoning === b.reasoning &&
        a.error === b.error &&
        JSON.stringify([a.tool_calls, a.workflow_state]) ===
            JSON.stringify([b.tool_calls, b.workflow_state])
    );
}

function terminalState(update: StreamUpdate) {
    if (update.kind === 'snapshot') {
        const job = update.job;
        return job.status === 'streaming'
            ? null
            : {
                  status: job.status,
                  attempt: job.attempts ?? 0,
                  content: job.content,
                  reasoning: job.reasoning,
                  error: job.error,
                  tool_calls: job.tool_calls,
                  workflow_state: job.workflow_state,
              };
    }
    const live = update.live;
    return live.type !== 'status' || live.status === 'streaming'
        ? null
        : {
              status: live.status,
              attempt: live.attempt ?? 0,
              content: live.content,
              reasoning: live.reasoning ?? '',
              error: live.error,
              tool_calls: live.tool_calls,
              workflow_state: live.workflow_state,
          };
}
