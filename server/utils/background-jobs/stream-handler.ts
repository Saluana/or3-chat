/**
 * @module server/utils/background-jobs/stream-handler
 *
 * Purpose:
 * Orchestrates background streaming jobs when the client disconnects.
 * This module bridges OpenRouter SSE streams with job persistence, live
 * viewer updates, and server-side notifications.
 *
 * Responsibilities:
 * - Start background jobs and spawn streaming loops.
 * - Consume SSE streams and persist incremental updates.
 * - Emit live updates to connected viewers.
 * - Emit completion or error notifications when no viewers remain.
 *
 * Non-Goals:
 * - Client HTTP response streaming.
 * - Provider selection logic beyond using the configured provider.
 *
 * Constraints:
 * - Runs on the server only.
 * - Uses OpenRouter SSE payload format.
 */

import { useRuntimeConfig } from '#imports';
import type { BackgroundJobProvider } from '../background-jobs/types';
import {
    getJobProvider,
    isBackgroundStreamingEnabled,
} from '../background-jobs/store';
import {
    parseOpenRouterSSE,
    type StreamedFieldMode,
} from '~~/shared/openrouter/parseOpenRouterSSE';
import { getNotificationEmitter } from '../notifications/registry';
import {
    emitJobDelta,
    emitJobStatus,
    hasJobViewers,
    initJobLiveState,
} from './viewers';
import { logBackgroundEvent } from './logging';
import type { ToolCall, ToolDefinition } from '~/utils/chat/types';
import { executeServerTool } from '../chat/tool-registry';
import { MAX_TOOL_ITERATIONS } from '~/utils/chat/constants';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import {
    emitBackgroundJobWebhookEvent,
    emitMessageCompletedWebhookEvent,
} from '../webhooks/hook-emissions';
import { snapshotToolDefinitions } from '~~/shared/chat/tool-policy';
import { sensitiveValueMetadata } from '~~/shared/logging/sensitive-metadata';
import {
    projectToolResult,
} from '~~/shared/chat/tool-limits';
import {
    decideToolCall,
    toolCallFingerprint,
    type ToolLedgerEntry,
} from '~~/shared/chat/tool-ledger';
import {
    beginNormalizedIteration,
    createNormalizedStreamState,
    failNormalizedStream,
    finishNormalizedIteration,
    reduceNormalizedStreamEvent,
    settleNormalizedTool,
} from '~~/shared/chat/normalized-stream-reducer';
import {
    canonicalToolResult,
    type CanonicalToolResult,
} from '~~/shared/chat/canonical-tool-transcript';
import {
    fetchWithResponseDeadline,
    readResponseTextWithIdleDeadline,
    withIdleWatchdog,
} from '~~/shared/openrouter/deadlines';

function logBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function warnBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function createAbortError(message = 'Job aborted by user'): Error {
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
}

function resolveOpenRouterChatCompletionsUrl(): string {
    try {
        const config = useRuntimeConfig();
        return getOpenRouterChatCompletionsUrl(config.openrouterBaseUrl);
    } catch {
        return getOpenRouterChatCompletionsUrl(undefined);
    }
}

function isForcedFunctionToolChoice(
    value: unknown
): value is { type: 'function'; function: { name: string } } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.type !== 'function') return false;
    const fn = candidate.function;
    if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return false;
    const name = (fn as Record<string, unknown>).name;
    return typeof name === 'string' && name.length > 0;
}

async function assertJobNotAborted(params: {
    provider: BackgroundJobProvider;
    jobId: string;
    abortSignal?: AbortSignal;
}): Promise<void> {
    if (params.abortSignal?.aborted) {
        throw createAbortError();
    }
    if (params.provider.checkJobAborted) {
        const aborted = await params.provider.checkJobAborted(params.jobId);
        if (aborted) {
            throw createAbortError();
        }
    }
}

/**
 * Purpose:
 * Input required to start a background streaming job.
 *
 * Constraints:
 * - `body` must be a validated OpenRouter request payload.
 * - `apiKey` must be a valid OpenRouter API key.
 */
export interface BackgroundStreamParams {
    body: Record<string, unknown>;
    apiKey: string;
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    referer: string;
}

function normalizeStreamedFieldMode(value: unknown): StreamedFieldMode {
    return value === 'cumulative-snapshot' ? value : 'delta';
}

/**
 * Purpose:
 * Result returned when a background job is started.
 */
export interface BackgroundStreamResult {
    jobId: string;
    status: 'streaming';
}

/**
 * Purpose:
 * Detect whether a request payload opts into background mode.
 *
 * Behavior:
 * - Returns `true` only when `_background` is explicitly set to `true`.
 */
export function isBackgroundModeRequest(body: Record<string, unknown>): boolean {
    return body._background === true;
}

/**
 * Purpose:
 * Validate and extract background mode identifiers from a request payload.
 *
 * Behavior:
 * - Ensures `_threadId` and `_messageId` are present and non-empty strings.
 * - Returns a structured result with an error message when invalid.
 */
export function validateBackgroundParams(body: Record<string, unknown>): {
    valid: boolean;
    threadId?: string;
    messageId?: string;
    error?: string;
} {
    const threadId = body._threadId;
    const messageId = body._messageId;

    if (typeof threadId !== 'string' || !threadId) {
        return { valid: false, error: 'Missing _threadId for background mode' };
    }

    if (typeof messageId !== 'string' || !messageId) {
        return { valid: false, error: 'Missing _messageId for background mode' };
    }

    return { valid: true, threadId, messageId };
}

/**
 * Purpose:
 * Create and start a background streaming job.
 *
 * Behavior:
 * - Creates a provider job record.
 * - Starts a fire-and-forget streaming loop.
 * - Returns the job ID immediately.
 *
 * Constraints:
 * - Errors in the background loop are captured and recorded on the job.
 */
export async function startBackgroundStream(
    params: BackgroundStreamParams
): Promise<BackgroundStreamResult> {
    const provider = await getJobProvider();
    const model = (params.body.model as string) || 'unknown';
    logBgStream('server-background-start-attempt', {
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
        hasTools: Array.isArray(params.body.tools) && params.body.tools.length > 0,
    });

    // Create job
    const jobId = await provider.createJob({
        userId: params.userId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
        kind: 'chat',
    });
    logBackgroundEvent('info', 'background.chat.started', {
        jobId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
        hasTools: Array.isArray(params.body.tools) && params.body.tools.length > 0,
    });

    // Fire-and-forget the streaming
    streamInBackground(jobId, params, provider).catch((err) => {
        warnBgStream('server-background-loop-failed', {
            jobId,
            userId: params.userId,
            workspaceId: params.workspaceId,
            threadId: params.threadId,
            messageId: params.messageId,
            error: err instanceof Error ? err.message : String(err),
        });
        logBackgroundEvent('error', 'background.chat.failed', {
            jobId,
            userId: params.userId,
            workspaceId: params.workspaceId,
            threadId: params.threadId,
            messageId: params.messageId,
            error: err instanceof Error ? err.message : String(err),
        });
        void provider.failJob(jobId, err instanceof Error ? err.message : String(err));
    });
    logBgStream('server-background-started', {
        jobId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
    });

    return { jobId, status: 'streaming' };
}

/**
 * Purpose:
 * Consume a background stream and persist incremental updates.
 *
 * Behavior:
 * - Parses OpenRouter SSE events and accumulates content.
 * - Periodically flushes updates to the provider.
 * - Emits live deltas and status updates for viewers.
 * - Sends notifications only when no viewers remain.
 *
 * Constraints:
 * - Flush cadence is tuned for SSE throughput, not durable delivery guarantees.
 * - Convex providers require polling for abort status.
 */
export async function consumeBackgroundStream(params: {
    jobId: string;
    stream: ReadableStream<Uint8Array>;
    context: BackgroundStreamParams;
    provider: BackgroundJobProvider;
    shouldNotify?: () => boolean;
    flushOnEveryChunk?: boolean;
    flushIntervalMs?: number;
    flushChunkInterval?: number;
    streamedFieldMode?: StreamedFieldMode;
}): Promise<void> {
    let fullContent = '';
    let chunks = 0;
    let normalizedState = beginNormalizedIteration(
        createNormalizedStreamState()
    );
    const flushEveryChunk = params.flushOnEveryChunk ?? false;
    const UPDATE_INTERVAL =
        typeof params.flushChunkInterval === 'number'
            ? Math.max(1, Math.floor(params.flushChunkInterval))
            : flushEveryChunk
            ? 1
            : 50;
    const UPDATE_INTERVAL_MS =
        typeof params.flushIntervalMs === 'number'
            ? Math.max(0, Math.floor(params.flushIntervalMs))
            : flushEveryChunk
            ? 30
            : 500;
    const notificationEmitter = getNotificationEmitter(params.provider.name);
    const shouldNotify = params.shouldNotify ?? (() => true);
    let pendingChunk = '';
    let lastUpdateAt = Date.now();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushScheduled = false;
    let flushInFlight = Promise.resolve();
    let flushError: unknown = null;
    logBgStream('server-consume-background-start', {
        jobId: params.jobId,
        userId: params.context.userId,
        workspaceId: params.context.workspaceId,
        threadId: params.context.threadId,
        flushEveryChunk,
        updateInterval: UPDATE_INTERVAL,
        updateIntervalMs: UPDATE_INTERVAL_MS,
    });

    initJobLiveState(params.jobId);

    const clearFlushTimer = () => {
        if (!flushScheduled) return;
        clearTimeout(flushTimer as ReturnType<typeof setTimeout>);
        flushTimer = null;
        flushScheduled = false;
    };

    const scheduleFlush = (delayMs: number) => {
        if (flushScheduled) return;
        flushScheduled = true;
        flushTimer = setTimeout(() => {
            flushScheduled = false;
            flushTimer = null;
            void flushPending();
        }, Math.max(0, delayMs));
    };

    const flushPending = async () => {
        flushInFlight = flushInFlight.then(async () => {
            if (!pendingChunk) return;
            const chunk = pendingChunk;
            pendingChunk = '';
            await params.provider.updateJob(params.jobId, {
                contentChunk: chunk,
                chunksReceived: chunks,
            });
            lastUpdateAt = Date.now();

            if (params.provider.checkJobAborted) {
                const aborted = await params.provider.checkJobAborted(params.jobId);
                if (aborted) {
                    const abortErr = new Error('Job aborted by user');
                    abortErr.name = 'AbortError';
                    throw abortErr;
                }
            }
        }).catch((err) => {
            flushError = err;
            warnBgStream('server-consume-background-flush-error', {
                jobId: params.jobId,
                error: err instanceof Error ? err.message : String(err),
            });
        });

        return flushInFlight;
    };

    try {
        for await (const evt of parseOpenRouterSSE(params.stream, {
            streamedFieldMode: params.streamedFieldMode,
        })) {
            normalizedState = reduceNormalizedStreamEvent(normalizedState, evt);
            if (evt.type === 'text') {
                fullContent = normalizedState.cumulativeText;
                chunks = normalizedState.chunks;
                pendingChunk += evt.text;
                emitJobDelta(params.jobId, evt.text, {
                    contentLength: fullContent.length,
                    chunksReceived: chunks,
                });

                const now = Date.now();
                const shouldFlushByChunk = chunks % UPDATE_INTERVAL === 0;
                const shouldFlushByTime =
                    UPDATE_INTERVAL_MS === 0
                        ? false
                        : now - lastUpdateAt >= UPDATE_INTERVAL_MS;

                // Update provider periodically
                if (pendingChunk) {
                    if (shouldFlushByChunk || shouldFlushByTime) {
                        void flushPending();
                    } else {
                        const remaining =
                            UPDATE_INTERVAL_MS > 0
                                ? UPDATE_INTERVAL_MS - (now - lastUpdateAt)
                                : 0;
                        scheduleFlush(remaining);
                    }
                }
                if (flushError) {
                    throw flushError;
                }
            }
        }

        clearFlushTimer();
        if (pendingChunk) {
            await flushPending();
        }
        await flushInFlight;
        if (flushError) {
            throw flushError;
        }
        normalizedState = finishNormalizedIteration(
            normalizedState,
            MAX_TOOL_ITERATIONS
        ).state;

        const latestJob = await params.provider.getJob(
            params.jobId,
            params.context.userId
        );
        if (!latestJob) {
            throw new Error('Background job disappeared before completion');
        }
        if (latestJob.status !== 'streaming') {
            if (latestJob.status === 'aborted') {
                throw createAbortError();
            }
            throw new Error(
                `Background job is no longer streaming (status: ${latestJob.status})`
            );
        }

        // Complete the job
        await params.provider.completeJob(params.jobId, fullContent);
        logBgStream('server-consume-background-complete', {
            jobId: params.jobId,
            chunks,
            contentLength: fullContent.length,
        });
        emitJobStatus(params.jobId, 'complete', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
        });
        await emitBackgroundJobWebhookEvent({
            status: 'completed',
            jobId: params.jobId,
            workspaceId: params.context.workspaceId,
            userId: params.context.userId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
        });
        await emitMessageCompletedWebhookEvent({
            workspaceId: params.context.workspaceId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
            modelId:
                typeof params.context.body.model === 'string'
                    ? params.context.body.model
                    : null,
            jobId: params.jobId,
        });

        const notifyOnComplete = shouldNotify();
        logBgStream('server-consume-background-notify-decision-complete', {
            jobId: params.jobId,
            notifyOnComplete,
            hasViewers: hasJobViewers(params.jobId),
            subscribersSuppressed: !notifyOnComplete,
        });
        if (notifyOnComplete) {
            // Emit server-side notification for job completion
            try {
                await notificationEmitter?.emitBackgroundJobComplete(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    params.context.messageId
                );
                logBgStream('server-consume-background-notify-complete-sent', {
                    jobId: params.jobId,
                    userId: params.context.userId,
                    workspaceId: params.context.workspaceId,
                    threadId: params.context.threadId,
                });
            } catch (err) {
                logBackgroundEvent(
                    'warn',
                    'background.chat.notification.complete_failed',
                    {
                        jobId: params.jobId,
                        error: err instanceof Error ? err.message : String(err),
                    }
                );
                warnBgStream('server-consume-background-notify-complete-failed', {
                    jobId: params.jobId,
                    error: err instanceof Error ? err.message : String(err),
                });
                // Do not fail the job if notification fails
            }
        }

    } catch (err) {
        normalizedState = failNormalizedStream(normalizedState, err);
        clearFlushTimer();
        try {
            if (pendingChunk) await flushPending();
            await flushInFlight;
        } catch {
            /* terminal handling below remains authoritative */
        }
        if (err instanceof Error && err.name === 'AbortError') {
            // Job was aborted (already marked in provider)
            logBgStream('server-consume-background-aborted', {
                jobId: params.jobId,
                chunks,
                contentLength: fullContent.length,
            });
            emitJobStatus(params.jobId, 'aborted', {
                content: fullContent,
                contentLength: fullContent.length,
                chunksReceived: chunks,
                completedAt: Date.now(),
            });
            return;
        }

        emitJobStatus(params.jobId, 'error', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
        });
        await emitBackgroundJobWebhookEvent({
            status: 'failed',
            jobId: params.jobId,
            workspaceId: params.context.workspaceId,
            userId: params.context.userId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
            error: err instanceof Error ? err.message : String(err),
        });
        warnBgStream('server-consume-background-error', {
            jobId: params.jobId,
            chunks,
            contentLength: fullContent.length,
            error: err instanceof Error ? err.message : String(err),
        });

        const notifyOnError = shouldNotify();
        logBgStream('server-consume-background-notify-decision-error', {
            jobId: params.jobId,
            notifyOnError,
            hasViewers: hasJobViewers(params.jobId),
            subscribersSuppressed: !notifyOnError,
        });
        if (notifyOnError) {
            // Emit error notification
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    err instanceof Error ? err.message : String(err)
                );
                logBgStream('server-consume-background-notify-error-sent', {
                    jobId: params.jobId,
                    userId: params.context.userId,
                    workspaceId: params.context.workspaceId,
                    threadId: params.context.threadId,
                });
            } catch (notifyErr) {
                logBackgroundEvent(
                    'warn',
                    'background.chat.notification.error_failed',
                    {
                        jobId: params.jobId,
                        error:
                            notifyErr instanceof Error
                                ? notifyErr.message
                                : String(notifyErr),
                    }
                );
                warnBgStream('server-consume-background-notify-error-failed', {
                    jobId: params.jobId,
                    error:
                        notifyErr instanceof Error
                            ? notifyErr.message
                            : String(notifyErr),
                });
            }
        }

        throw err;
    }
}

/**
 * Purpose:
 * Consume a background stream with tool execution support.
 *
 * Behavior:
 * - Handles tool_call events and executes server-registered tools.
 * - Updates job metadata with tool call status.
 * - Continues multi-turn tool loops (max 10 iterations).
 */
export async function consumeBackgroundStreamWithTools(params: {
    jobId: string;
    body: Record<string, unknown>;
    apiKey: string;
    referer: string;
    provider: BackgroundJobProvider;
    context: BackgroundStreamParams;
    toolRuntime?: Record<string, string>;
    shouldNotify?: () => boolean;
    abortSignal?: AbortSignal;
    streamedFieldMode?: StreamedFieldMode;
}): Promise<void> {
    let fullContent = '';
    let chunks = 0;
    let normalizedState = createNormalizedStreamState();
    const notificationEmitter = getNotificationEmitter(params.provider.name);
    const shouldNotify = params.shouldNotify ?? (() => true);
    const tools = snapshotToolDefinitions(
        Array.isArray(params.body.tools)
            ? (params.body.tools as ToolDefinition[])
            : undefined
    );
    const admittedByName = new Map(
        (tools ?? []).map((definition) => [definition.function.name, definition])
    );
    const requestedToolChoice = params.body.tool_choice;
    let activeToolChoice: unknown = requestedToolChoice;

    const toolRuntime = params.toolRuntime ?? {};
    const toolStates = new Map<string, {
        id?: string;
        name: string;
        status: 'loading' | 'complete' | 'error' | 'pending' | 'skipped';
        args?: string;
        result?: string;
        error?: string;
        argument_fingerprint?: string;
        transcript?: CanonicalToolResult;
    }>();
    const toolLedger = new Map<string, ToolLedgerEntry>();
    let pendingProviderContent = '';
    let providerDirtyEvents = 0;
    let lastProviderFlushAt = Date.now();
    const persistedJob = await params.provider.getJob(params.jobId, params.context.userId);
    for (const call of persistedJob?.tool_calls ?? []) {
        if (!call.id) continue;
        const fingerprint = call.argument_fingerprint
            ?? (call.args === undefined ? '' : toolCallFingerprint(call.name, call.args));
        if (!fingerprint) continue;
        const state = call.status === 'complete' ? 'completed'
            : call.status === 'error' || call.status === 'skipped' ? 'failed'
            : call.status === 'loading' ? 'running' : 'pending';
        toolStates.set(call.id, { ...call, argument_fingerprint: fingerprint });
        toolLedger.set(call.id, {
            callId: call.id, name: call.name, argumentFingerprint: fingerprint,
            state, result: call.result, error: call.error,
        });
    }

    const flushProviderProgress = async (force = false) => {
        if (providerDirtyEvents === 0) return;
        if (
            !force &&
            providerDirtyEvents < 50 &&
            pendingProviderContent.length < 16 * 1024 &&
            Date.now() - lastProviderFlushAt < 500
        ) return;
        const contentChunk = pendingProviderContent;
        pendingProviderContent = '';
        providerDirtyEvents = 0;
        await params.provider.updateJob(params.jobId, {
            contentChunk: contentChunk || undefined,
            chunksReceived: chunks,
            tool_calls: Array.from(toolStates.values()),
        });
        lastProviderFlushAt = Date.now();
    };

    const emitToolState = async (force = false) => {
        const tool_calls = Array.from(toolStates.values());
        providerDirtyEvents += 1;
        await flushProviderProgress(force);
        const publicToolCalls = tool_calls.map((call) => ({
            ...call,
            result: call.result === undefined ? undefined : projectToolResult(call.result).ui,
        }));
        logBgStream('server-consume-tools-state', {
            jobId: params.jobId,
            toolCallCount: tool_calls.length,
            statusSummary: tool_calls.map((call) => ({
                id: call.id,
                name: call.name,
                status: call.status,
            })),
        });
        emitJobStatus(params.jobId, 'streaming', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            tool_calls: publicToolCalls,
        });
    };

    initJobLiveState(params.jobId);
    logBgStream('server-consume-tools-start', {
        jobId: params.jobId,
        userId: params.context.userId,
        workspaceId: params.context.workspaceId,
        threadId: params.context.threadId,
        toolCount: Array.isArray(params.body.tools) ? params.body.tools.length : 0,
    });

    const orMessages = Array.isArray(params.body.messages)
        ? params.body.messages.slice()
        : [];
    logBackgroundEvent('info', 'background.tools.started', {
        jobId: params.jobId,
        userId: params.context.userId,
        workspaceId: params.context.workspaceId,
        threadId: params.context.threadId,
        messageId: params.context.messageId,
        model: params.body.model,
        requestedTools: tools?.map((tool) => tool.function.name) ?? [],
    });

    try {
        const openRouterUrl = resolveOpenRouterChatCompletionsUrl();
        while (true) {
            normalizedState = beginNormalizedIteration(normalizedState);
            const loopIteration = normalizedState.iteration;
            logBackgroundEvent('info', 'background.tools.iteration.started', {
                jobId: params.jobId,
                iteration: loopIteration,
            });
            await assertJobNotAborted({
                provider: params.provider,
                jobId: params.jobId,
                abortSignal: params.abortSignal,
            });

            const requestBody = {
                ...params.body,
                messages: orMessages,
                tools,
                tool_choice:
                    tools &&
                    activeToolChoice !== undefined
                        ? activeToolChoice
                        : tools
                        ? 'auto'
                        : undefined,
                stream: true,
            } as Record<string, unknown>;

            const upstream = await fetchWithResponseDeadline(openRouterUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${params.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'HTTP-Referer': params.referer,
                    'X-Title': 'or3.chat',
                },
                body: JSON.stringify(requestBody),
            }, { signal: params.abortSignal });
            logBgStream('server-consume-tools-upstream-response', {
                jobId: params.jobId,
                iteration: loopIteration,
                status: upstream.status,
                ok: upstream.ok,
                hasBody: Boolean(upstream.body),
            });

            if (!upstream.ok || !upstream.body) {
                const errorText = await readResponseTextWithIdleDeadline(upstream, {
                    signal: params.abortSignal,
                }).catch(() => '<no body>');
                logBackgroundEvent('warn', 'background.tools.upstream_rejected', {
                    jobId: params.jobId,
                    iteration: loopIteration,
                    status: upstream.status,
                    responseMetadata: sensitiveValueMetadata(errorText),
                });
                throw new Error(`OpenRouter error ${upstream.status}`);
            }

            const pendingToolCalls: ToolCall[] = [];
            let loopContent = '';
            const guardedBody = withIdleWatchdog(upstream.body, {
                signal: params.abortSignal,
            });
            for await (const evt of parseOpenRouterSSE(guardedBody, {
                streamedFieldMode: params.streamedFieldMode,
            })) {
                await assertJobNotAborted({
                    provider: params.provider,
                    jobId: params.jobId,
                    abortSignal: params.abortSignal,
                });
                normalizedState = reduceNormalizedStreamEvent(normalizedState, evt);
                if (evt.type === 'text') {
                    fullContent = normalizedState.cumulativeText;
                    loopContent = normalizedState.iterationText;
                    chunks = normalizedState.chunks;
                    pendingProviderContent += evt.text;
                    providerDirtyEvents += 1;
                    emitJobDelta(params.jobId, evt.text, {
                        contentLength: fullContent.length,
                        chunksReceived: chunks,
                    });
                    await flushProviderProgress();
                }
                if (evt.type === 'tool_call') {
                    const toolCall = evt.tool_call;
                    logBackgroundEvent('info', 'background.tools.call.received', {
                        jobId: params.jobId,
                        iteration: loopIteration,
                        toolCallId: toolCall.id,
                        toolName: toolCall.function.name,
                        argumentMetadata: sensitiveValueMetadata(toolCall.function.arguments),
                    });
                    pendingToolCalls.push(toolCall);
                    if (!toolStates.has(toolCall.id)) {
                        const fingerprint = toolCallFingerprint(
                            toolCall.function.name,
                            toolCall.function.arguments
                        );
                        toolStates.set(toolCall.id, {
                            id: toolCall.id,
                            name: toolCall.function.name,
                            status: 'pending',
                            args: toolCall.function.arguments,
                            argument_fingerprint: fingerprint,
                        });
                        toolLedger.set(toolCall.id, {
                            callId: toolCall.id,
                            name: toolCall.function.name,
                            argumentFingerprint: fingerprint,
                            state: 'pending',
                        });
                    }
                    await emitToolState();
                }
            }

            await flushProviderProgress(true);

            if (normalizedState.iterationToolCallIds.length === 0) {
                normalizedState = finishNormalizedIteration(
                    normalizedState,
                    MAX_TOOL_ITERATIONS
                ).state;
                break;
            }

            const toolResultsForNextLoop: Array<{
                call: ToolCall;
                result: string;
            }> = [];

            for (const toolCall of pendingToolCalls) {
                await assertJobNotAborted({
                    provider: params.provider,
                    jobId: params.jobId,
                    abortSignal: params.abortSignal,
                });
                const runtimeHint = toolRuntime[toolCall.function.name];
                const admittedDefinition = admittedByName.get(toolCall.function.name);
                const decision = decideToolCall(toolLedger.get(toolCall.id), {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                });
                let toolResultText = '';
                let status: 'complete' | 'error' | 'skipped' = 'complete';
                let errorMessage: string | undefined;

                if (decision.action === 'replay') {
                    toolResultText = decision.result;
                } else if (decision.action === 'conflict') {
                    status = 'error';
                    errorMessage = `Tool call ID "${toolCall.id}" was reused with different arguments.`;
                    toolResultText = errorMessage;
                } else if (decision.action === 'running') {
                    status = 'error';
                    errorMessage = `Tool call "${toolCall.id}" may already have executed; refusing replay.`;
                    toolResultText = errorMessage;
                } else if (decision.action === 'failed') {
                    status = 'error';
                    errorMessage = decision.error;
                    toolResultText = errorMessage;
                } else if (!admittedDefinition) {
                    status = 'skipped';
                    errorMessage = `Tool "${toolCall.function.name}" was not advertised for this request.`;
                    toolResultText = errorMessage;
                } else if (runtimeHint === 'client') {
                    status = 'skipped';
                    errorMessage = `Tool \"${toolCall.function.name}\" is client-only.`;
                    toolResultText = errorMessage;
                } else {
                    toolLedger.set(toolCall.id, {
                        callId: toolCall.id,
                        name: toolCall.function.name,
                        argumentFingerprint: decision.fingerprint,
                        state: 'running',
                    });
                    toolStates.set(toolCall.id, {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        status: 'loading',
                        args: toolCall.function.arguments,
                        argument_fingerprint: decision.fingerprint,
                    });
                    await emitToolState(true);
                    const execution = await executeServerTool(
                        toolCall.function.name,
                        toolCall.function.arguments,
                        {
                            subject: params.context.userId,
                            workspaceId: params.context.workspaceId,
                            threadId: params.context.threadId,
                            messageId: params.context.messageId,
                            callId: toolCall.id,
                            requestId: params.jobId,
                            abortSignal: params.abortSignal ?? new AbortController().signal,
                        },
                        { definition: admittedDefinition }
                    );
                    if (execution.error) {
                        status = execution.runtime === 'client' ? 'skipped' : 'error';
                        errorMessage = execution.error;
                        toolResultText = `Error executing tool \"${toolCall.function.name}\": ${execution.error}`;
                    } else {
                        toolResultText = execution.result || '';
                    }
                }
                const projectedResult = projectToolResult(toolResultText);
                toolLedger.set(toolCall.id, {
                    callId: toolCall.id,
                    name: toolCall.function.name,
                    argumentFingerprint: decision.fingerprint,
                    state: status === 'complete' ? 'completed' : 'failed',
                    result: status === 'complete' ? projectedResult.durable : undefined,
                    error: status === 'complete' ? undefined : errorMessage,
                });

                logBackgroundEvent('info', 'background.tools.call.completed', {
                    jobId: params.jobId,
                    iteration: loopIteration,
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    status,
                    argumentMetadata: sensitiveValueMetadata(toolCall.function.arguments),
                    resultMetadata:
                        status === 'complete'
                            ? sensitiveValueMetadata(toolResultText)
                            : undefined,
                    errorMetadata: errorMessage
                        ? sensitiveValueMetadata(errorMessage)
                        : undefined,
                });

                toolStates.set(toolCall.id, {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    status,
                    args: toolCall.function.arguments,
                    result: status === 'complete' ? projectedResult.durable : undefined,
                    error: status !== 'complete' ? errorMessage : undefined,
                    argument_fingerprint: decision.fingerprint,
                    transcript: canonicalToolResult({
                        turnId: params.context.messageId,
                        parentAssistantId: params.context.messageId,
                        callId: toolCall.id,
                        toolName: toolCall.function.name,
                        fingerprint: decision.fingerprint,
                        status: status === 'complete' ? 'complete' : 'error',
                        result: projectedResult.durable,
                        error: status === 'complete' ? undefined : errorMessage,
                    }),
                });
                normalizedState = settleNormalizedTool(
                    normalizedState,
                    toolCall.id,
                    status === 'complete'
                        ? { status: 'complete', result: projectedResult.durable }
                        : { status: status === 'skipped' ? 'skipped' : 'error', error: errorMessage }
                );
                await emitToolState();

                toolResultsForNextLoop.push({ call: toolCall, result: projectedResult.model });
            }

            orMessages.push({
                role: 'assistant',
                content: [{ type: 'text', text: loopContent || '' }],
                tool_calls: pendingToolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: 'function' as const,
                    function: {
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments,
                    },
                })),
            });

            for (const payload of toolResultsForNextLoop) {
                orMessages.push({
                    role: 'tool',
                    tool_call_id: payload.call.id,
                    name: payload.call.function.name,
                    content: [{ type: 'text', text: payload.result }],
                });
            }

            await flushProviderProgress(true);

            // If the caller forced a specific function, only enforce that on the first
            // turn; subsequent turns should allow the model to produce the final answer.
            if (isForcedFunctionToolChoice(activeToolChoice)) {
                activeToolChoice = 'auto';
            }

            normalizedState = finishNormalizedIteration(
                normalizedState,
                MAX_TOOL_ITERATIONS
            ).state;

        }

        const latestJob = await params.provider.getJob(
            params.jobId,
            params.context.userId
        );
        if (!latestJob) {
            throw new Error('Background job disappeared before completion');
        }
        if (latestJob.status !== 'streaming') {
            if (latestJob.status === 'aborted') {
                throw createAbortError();
            }
            throw new Error(
                `Background job is no longer streaming (status: ${latestJob.status})`
            );
        }

        await flushProviderProgress(true);
        await params.provider.completeJob(params.jobId, fullContent);
        logBackgroundEvent('info', 'background.tools.completed', {
            jobId: params.jobId,
            chunksReceived: chunks,
            contentLength: fullContent.length,
            toolCalls: Array.from(toolStates.values()).map((call) => ({
                id: call.id,
                name: call.name,
                status: call.status,
            })),
        });
        emitJobStatus(params.jobId, 'complete', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            tool_calls: Array.from(toolStates.values()),
        });
        await emitBackgroundJobWebhookEvent({
            status: 'completed',
            jobId: params.jobId,
            workspaceId: params.context.workspaceId,
            userId: params.context.userId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
        });
        await emitMessageCompletedWebhookEvent({
            workspaceId: params.context.workspaceId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
            modelId:
                typeof params.context.body.model === 'string'
                    ? params.context.body.model
                    : null,
            jobId: params.jobId,
        });

        const notifyOnComplete = shouldNotify();
        logBgStream('server-consume-tools-notify-decision-complete', {
            jobId: params.jobId,
            notifyOnComplete,
            hasViewers: hasJobViewers(params.jobId),
        });
        if (notifyOnComplete) {
            try {
                await notificationEmitter?.emitBackgroundJobComplete(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    params.context.messageId
                );
                logBgStream('server-consume-tools-notify-complete-sent', {
                    jobId: params.jobId,
                    userId: params.context.userId,
                    workspaceId: params.context.workspaceId,
                    threadId: params.context.threadId,
                });
            } catch (err) {
                logBackgroundEvent(
                    'warn',
                    'background.tools.notification.complete_failed',
                    {
                        jobId: params.jobId,
                        error: err instanceof Error ? err.message : String(err),
                    }
                );
                warnBgStream('server-consume-tools-notify-complete-failed', {
                    jobId: params.jobId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    } catch (err) {
        normalizedState = failNormalizedStream(normalizedState, err);
        // Preserve the last coalesced text/tool snapshot before publishing a
        // terminal error. A failed flush must not hide the original failure.
        try {
            await flushProviderProgress(true);
        } catch {
            /* terminal handling below remains authoritative */
        }
        if (err instanceof Error && err.name === 'AbortError') {
            logBgStream('server-consume-tools-aborted', {
                jobId: params.jobId,
                chunks,
                contentLength: fullContent.length,
            });
            emitJobStatus(params.jobId, 'aborted', {
                content: fullContent,
                contentLength: fullContent.length,
                chunksReceived: chunks,
                completedAt: Date.now(),
                tool_calls: Array.from(toolStates.values()),
            });
            return;
        }

        emitJobStatus(params.jobId, 'error', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
            tool_calls: Array.from(toolStates.values()),
        });
        await emitBackgroundJobWebhookEvent({
            status: 'failed',
            jobId: params.jobId,
            workspaceId: params.context.workspaceId,
            userId: params.context.userId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
            error: err instanceof Error ? err.message : String(err),
        });
        warnBgStream('server-consume-tools-error', {
            jobId: params.jobId,
            iteration: normalizedState.iteration,
            chunks,
            contentLength: fullContent.length,
            error: err instanceof Error ? err.message : String(err),
        });
        logBackgroundEvent('error', 'background.tools.failed', {
            jobId: params.jobId,
            iteration: normalizedState.iteration,
            chunksReceived: chunks,
            contentLength: fullContent.length,
            error: err instanceof Error ? err.message : String(err),
            toolCalls: Array.from(toolStates.values()).map((call) => ({
                id: call.id,
                name: call.name,
                status: call.status,
                argumentMetadata: call.args
                    ? sensitiveValueMetadata(call.args)
                    : undefined,
                errorMetadata: call.error
                    ? sensitiveValueMetadata(call.error)
                    : undefined,
            })),
        });

        const notifyOnError = shouldNotify();
        logBgStream('server-consume-tools-notify-decision-error', {
            jobId: params.jobId,
            notifyOnError,
            hasViewers: hasJobViewers(params.jobId),
        });
        if (notifyOnError) {
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    err instanceof Error ? err.message : String(err)
                );
                logBgStream('server-consume-tools-notify-error-sent', {
                    jobId: params.jobId,
                    userId: params.context.userId,
                    workspaceId: params.context.workspaceId,
                    threadId: params.context.threadId,
                });
            } catch (notifyErr) {
                logBackgroundEvent(
                    'warn',
                    'background.tools.notification.error_failed',
                    {
                        jobId: params.jobId,
                        error:
                            notifyErr instanceof Error
                                ? notifyErr.message
                                : String(notifyErr),
                    }
                );
                warnBgStream('server-consume-tools-notify-error-failed', {
                    jobId: params.jobId,
                    error:
                        notifyErr instanceof Error
                            ? notifyErr.message
                            : String(notifyErr),
                });
            }
        }

        throw err;
    }
}

/**
 * Stream in the background without keeping a client connection open.
 */
async function streamInBackground(
    jobId: string,
    params: BackgroundStreamParams,
    provider: BackgroundJobProvider
): Promise<void> {
    // Get abort controller if provider supports it (memory provider)
    const ac = provider.getAbortController?.(jobId) ?? new AbortController();

    // Strip internal fields from body before sending to OpenRouter
    const {
        _background,
        _threadId,
        _messageId,
        _backgroundMode,
        _toolRuntime,
        _streamedFieldMode,
        ...cleanBody
    } = params.body;
    const toolRuntime =
        typeof _toolRuntime === 'object' && _toolRuntime !== null
            ? (_toolRuntime as Record<string, string>)
            : undefined;
    const streamedFieldMode = normalizeStreamedFieldMode(_streamedFieldMode);

    const hasTools =
        Array.isArray(cleanBody.tools) && cleanBody.tools.length > 0;
    logBgStream('server-stream-in-background-start', {
        jobId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        hasTools,
    });
    if (hasTools) {
        logBgStream('server-stream-in-background-tools-mode', {
            jobId,
            toolCount: Array.isArray(cleanBody.tools) ? cleanBody.tools.length : 0,
        });
        await consumeBackgroundStreamWithTools({
            jobId,
            body: cleanBody,
            apiKey: params.apiKey,
            referer: params.referer,
            provider,
            context: params,
            toolRuntime,
            shouldNotify: () => !hasJobViewers(jobId),
            abortSignal: ac.signal,
            streamedFieldMode,
        });
        return;
    }

    const openRouterUrl = resolveOpenRouterChatCompletionsUrl();
    const upstream = await fetchWithResponseDeadline(openRouterUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'HTTP-Referer': params.referer,
            'X-Title': 'or3.chat',
        },
        body: JSON.stringify(cleanBody),
    }, { signal: ac.signal });
    logBgStream('server-stream-in-background-upstream-response', {
        jobId,
        status: upstream.status,
        ok: upstream.ok,
        hasBody: Boolean(upstream.body),
    });

    if (!upstream.ok || !upstream.body) {
        const errorText = await readResponseTextWithIdleDeadline(upstream, {
            signal: ac.signal,
        }).catch(() => '<no body>');
        warnBgStream('server-stream-in-background-upstream-failed', {
            jobId,
            status: upstream.status,
            responseMetadata: sensitiveValueMetadata(errorText),
        });
        throw new Error(`OpenRouter error ${upstream.status}`);
    }

    await consumeBackgroundStream({
        jobId,
        stream: withIdleWatchdog(upstream.body, { signal: ac.signal }),
        context: params,
        provider,
        shouldNotify: () => !hasJobViewers(jobId),
        streamedFieldMode,
    });
}

/**
 * Purpose:
 * Expose background streaming availability for route handlers.
 */
export function isBackgroundStreamingAvailable(): boolean {
    return isBackgroundStreamingEnabled();
}
