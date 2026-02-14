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
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import {
    getJobLiveState,
    registerJobStream,
    registerJobViewer,
} from '../../../utils/background-jobs/viewers';

type StreamEventPayload = {
    event: 'snapshot' | 'delta' | 'status';
    status: {
        id: string;
        status: BackgroundJob['status'];
        threadId: string;
        messageId: string;
        model: string;
        chunksReceived: number;
        startedAt: number;
        completedAt?: number;
        error?: string;
        content?: string;
        content_delta?: string;
        content_length?: number;
        tool_calls?: BackgroundJob['tool_calls'];
        workflow_state?: BackgroundJob['workflow_state'];
    };
};

const ACTIVE_POLL_INTERVAL_MS = 80;
const IDLE_POLL_INTERVAL_MS = 300;
const KEEPALIVE_INTERVAL_MS = 15_000;

export function serializeJobStatus(
    job: BackgroundJob,
    overrides?: {
        content?: string;
        content_delta?: string;
        content_length?: number;
        includeContent?: boolean;
        tool_calls?: BackgroundJob['tool_calls'];
        workflow_state?: BackgroundJob['workflow_state'];
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
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        tool_calls: overrides?.tool_calls ?? job.tool_calls,
        workflow_state: overrides?.workflow_state ?? job.workflow_state,
        content_delta: overrides?.content_delta,
        content_length:
            typeof overrides?.content_length === 'number'
                ? overrides.content_length
                : job.content.length,
    };

    if (includeContent) {
        status.content =
            typeof contentOverride === 'string' ? contentOverride : job.content;
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
        setResponseStatus(event, 400);
        return { error: 'Missing job ID' };
    }

    // Resolve user ID for authorization
    let userId: string | null = null;
    if (isSsrAuthEnabled(event)) {
        const session = await resolveSessionContext(event);
        if (session.authenticated && session.user?.id) {
            userId = session.user.id;
        }
    }

    if (!userId) {
        setResponseStatus(event, 401);
        return { error: 'Authentication required' };
    }

    const provider = await getJobProvider();
    const initialJob = await provider.getJob(jobId, userId);

    if (!initialJob) {
        setResponseStatus(event, 404);
        return { error: 'Job not found or unauthorized' };
    }

    const query = getQuery(event);
    const offsetParam = typeof query.offset === 'string' ? query.offset : null;
    const offset = offsetParam ? Number(offsetParam) : null;
    const initialOffset =
        typeof offset === 'number' && Number.isFinite(offset) && offset >= 0
            ? Math.min(offset, initialJob.content.length)
            : 0;

    setHeader(event, 'Content-Type', 'text/event-stream');
    setHeader(event, 'Cache-Control', 'no-cache, no-transform');
    setHeader(event, 'Connection', 'keep-alive');

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            let closed = false;
            let lastContentLength = initialOffset;
            let lastStatus: BackgroundJob['status'] = initialJob.status;
            let pollInterval =
                initialJob.status === 'streaming'
                    ? ACTIVE_POLL_INTERVAL_MS
                    : IDLE_POLL_INTERVAL_MS;

            const disposeViewer = registerJobViewer(jobId);
            let disposeLive: (() => void) | null = null;
            const isClosed = () => closed;

            const closeStream = () => {
                if (isClosed()) return;
                closed = true;
                try {
                    controller.close();
                } catch {
                    /* intentionally empty */
                }
                if (disposeLive) {
                    disposeLive();
                    disposeLive = null;
                }
                disposeViewer();
            };

            event.node.req.on('close', () => {
                closeStream();
            });

            const write = (payload: StreamEventPayload) => {
                if (isClosed()) return;
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
                );
            };

            // Send initial snapshot
            if (initialOffset === 0) {
                write({
                    event: 'snapshot',
                    status: serializeJobStatus(initialJob, {
                        content: initialJob.content,
                        content_length: initialJob.content.length,
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
                    }),
                });
            }
            lastContentLength = initialJob.content.length;

            if (initialJob.status === 'streaming') {
                // Subscribe to live stream updates (fast path when viewer is attached).
                disposeLive = registerJobStream(jobId, (liveEvent) => {
                    if (isClosed()) return;
                    if (liveEvent.type === 'delta') {
                        if (liveEvent.content_length <= lastContentLength)
                            return;
                        const currentLiveState = getJobLiveState(jobId);
                        lastContentLength = liveEvent.content_length;
                        lastStatus = 'streaming';
                        write({
                            event: 'delta',
                            status: serializeJobStatus(
                                {
                                    ...initialJob,
                                    status: 'streaming',
                                    chunksReceived: liveEvent.chunksReceived,
                                    tool_calls:
                                        liveEvent.tool_calls ??
                                        currentLiveState?.tool_calls ??
                                        initialJob.tool_calls,
                                    workflow_state:
                                        liveEvent.workflow_state ??
                                        currentLiveState?.workflow_state ??
                                        initialJob.workflow_state,
                                },
                                {
                                    includeContent: false,
                                    content_delta: liveEvent.content_delta,
                                    content_length: liveEvent.content_length,
                                    tool_calls:
                                        liveEvent.tool_calls ??
                                        currentLiveState?.tool_calls,
                                    workflow_state:
                                        liveEvent.workflow_state ??
                                        currentLiveState?.workflow_state,
                                }
                            ),
                        });
                        return;
                    }
                    lastStatus = liveEvent.status;
                    lastContentLength = liveEvent.content_length;
                    const currentLiveState = getJobLiveState(jobId);
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
                                tool_calls:
                                    liveEvent.tool_calls ??
                                    currentLiveState?.tool_calls ??
                                    initialJob.tool_calls,
                                workflow_state:
                                    liveEvent.workflow_state ??
                                    currentLiveState?.workflow_state ??
                                    initialJob.workflow_state,
                            },
                            {
                                includeContent: true,
                                content: liveEvent.content,
                                content_length: liveEvent.content_length,
                                tool_calls:
                                    liveEvent.tool_calls ??
                                    currentLiveState?.tool_calls,
                                workflow_state:
                                    liveEvent.workflow_state ??
                                    currentLiveState?.workflow_state,
                            }
                        ),
                    });
                    if (liveEvent.status !== 'streaming') {
                        closeStream();
                    }
                });

                const liveState = getJobLiveState(jobId);
                if (liveState && liveState.content.length > lastContentLength) {
                    const delta = liveState.content.slice(lastContentLength);
                    lastContentLength = liveState.content.length;
                    write({
                        event: 'delta',
                        status: serializeJobStatus(
                            {
                                ...initialJob,
                                status: 'streaming',
                                chunksReceived: liveState.chunksReceived,
                            },
                            {
                                includeContent: false,
                                content_delta: delta,
                                content_length: liveState.content.length,
                            }
                        ),
                    });
                }
            }

            const keepAlive = setInterval(() => {
                if (isClosed()) return;
                controller.enqueue(encoder.encode(': ping\n\n'));
            }, KEEPALIVE_INTERVAL_MS);

            try {
                while (!isClosed()) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, pollInterval)
                    );
                    if (isClosed()) break;

                    const job = await provider.getJob(jobId, userId);
                    if (!job) {
                        write({
                            event: 'status',
                            status: {
                                id: jobId,
                                status: 'error',
                                threadId: initialJob.threadId,
                                messageId: initialJob.messageId,
                                model: initialJob.model,
                                chunksReceived: initialJob.chunksReceived,
                                startedAt: initialJob.startedAt,
                                completedAt: Date.now(),
                                error: 'Job not found',
                                content: initialJob.content,
                                content_length: initialJob.content.length,
                            },
                        });
                        break;
                    }

                    pollInterval =
                        job.status === 'streaming'
                            ? ACTIVE_POLL_INTERVAL_MS
                            : IDLE_POLL_INTERVAL_MS;

                    const hasNewContent = job.content.length > lastContentLength;
                    const statusChanged = job.status !== lastStatus;

                    if (hasNewContent) {
                        const delta = job.content.slice(lastContentLength);
                        lastContentLength = job.content.length;
                        write({
                            event: 'delta',
                            status: serializeJobStatus(job, {
                                includeContent: false,
                                content_delta: delta,
                                content_length: job.content.length,
                            }),
                        });
                    } else if (statusChanged) {
                        // Status change without new content
                        write({
                            event: 'status',
                            status: serializeJobStatus(job, {
                                content:
                                    job.status !== 'streaming'
                                        ? job.content
                                        : undefined,
                                includeContent: job.status !== 'streaming',
                                content_length: job.content.length,
                            }),
                        });
                    }

                    if (job.status !== 'streaming') {
                        if (!hasNewContent && !statusChanged) {
                            write({
                                event: 'status',
                                status: serializeJobStatus(job, {
                                    content: job.content,
                                    includeContent: true,
                                    content_length: job.content.length,
                                }),
                            });
                        }
                        break;
                    }

                    lastStatus = job.status;
                }
            } catch (err) {
                if (isClosed()) return;
                const message =
                    err instanceof Error ? err.message : 'Stream error';
                write({
                    event: 'status',
                    status: {
                        id: jobId,
                        status: 'error',
                        threadId: initialJob.threadId,
                        messageId: initialJob.messageId,
                        model: initialJob.model,
                        chunksReceived: initialJob.chunksReceived,
                        startedAt: initialJob.startedAt,
                        completedAt: Date.now(),
                        error: message,
                        content: initialJob.content,
                        content_length: initialJob.content.length,
                    },
                });
            } finally {
                clearInterval(keepAlive);
                closeStream();
            }
        },
        cancel() {
            // Client disconnected
        },
    });

    return sendStream(event, stream);
});
