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

import type { BackgroundJobProvider } from '../background-jobs/types';
import {
    getJobProvider,
    isBackgroundStreamingEnabled,
} from '../background-jobs/store';
import {
    parseOpenRouterSSE,
} from '~~/shared/openrouter/parseOpenRouterSSE';
import { getNotificationEmitter } from '../notifications/registry';
import {
    emitJobDelta,
    emitJobStatus,
    hasJobViewers,
    initJobLiveState,
} from './viewers';
import type { ToolCall, ToolDefinition } from '~/utils/chat/types';
import { executeServerTool } from '../chat/tool-registry';

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

function createAbortError(message = 'Job aborted by user'): Error {
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
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

    // Create job
    const jobId = await provider.createJob({
        userId: params.userId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
        kind: 'chat',
    });

    // Fire-and-forget the streaming
    streamInBackground(jobId, params, provider).catch((err) => {
        console.error('[background-stream] Job failed:', jobId, err);
        void provider.failJob(jobId, err instanceof Error ? err.message : String(err));
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
}): Promise<void> {
    let fullContent = '';
    let chunks = 0;
    const flushEveryChunk = params.flushOnEveryChunk ?? false;
    const UPDATE_INTERVAL =
        typeof params.flushChunkInterval === 'number'
            ? Math.max(1, Math.floor(params.flushChunkInterval))
            : flushEveryChunk
            ? 1
            : 3;
    const UPDATE_INTERVAL_MS =
        typeof params.flushIntervalMs === 'number'
            ? Math.max(0, Math.floor(params.flushIntervalMs))
            : flushEveryChunk
            ? 30
            : 120;
    const notificationEmitter = getNotificationEmitter(params.provider.name);
    const shouldNotify = params.shouldNotify ?? (() => true);
    let pendingChunk = '';
    let lastUpdateAt = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushScheduled = false;
    let flushInFlight = Promise.resolve();
    let flushError: unknown = null;

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
        });

        return flushInFlight;
    };

    try {
        for await (const evt of parseOpenRouterSSE(params.stream)) {
            if (evt.type === 'text') {
                fullContent += evt.text;
                chunks++;
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
        emitJobStatus(params.jobId, 'complete', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
        });

        if (shouldNotify()) {
            // Emit server-side notification for job completion
            try {
                await notificationEmitter?.emitBackgroundJobComplete(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId
                );
            } catch (err) {
                console.error(
                    '[background-stream] Failed to emit notification:',
                    err
                );
                // Do not fail the job if notification fails
            }
        }

    } catch (err) {
        clearFlushTimer();
        if (err instanceof Error && err.name === 'AbortError') {
            // Job was aborted (already marked in provider)
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

        if (shouldNotify()) {
            // Emit error notification
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    err instanceof Error ? err.message : String(err)
                );
            } catch (notifyErr) {
                console.error(
                    '[background-stream] Failed to emit error notification:',
                    notifyErr
                );
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
}): Promise<void> {
    const MAX_TOOL_ITERATIONS = 10;
    let fullContent = '';
    let chunks = 0;
    let loopIteration = 0;
    const notificationEmitter = getNotificationEmitter(params.provider.name);
    const shouldNotify = params.shouldNotify ?? (() => true);
    const tools = Array.isArray(params.body.tools)
        ? (params.body.tools as ToolDefinition[])
        : undefined;
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
    }>();

    const emitToolState = async () => {
        const tool_calls = Array.from(toolStates.values());
        await params.provider.updateJob(params.jobId, { tool_calls });
        emitJobStatus(params.jobId, 'streaming', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            tool_calls,
        });
    };

    initJobLiveState(params.jobId);

    const orMessages = Array.isArray(params.body.messages)
        ? params.body.messages.slice()
        : [];

    try {
        while (loopIteration < MAX_TOOL_ITERATIONS) {
            loopIteration += 1;
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

            const upstream = await fetch(OR_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${params.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'HTTP-Referer': params.referer,
                    'X-Title': 'or3.chat',
                },
                body: JSON.stringify(requestBody),
                signal: params.abortSignal,
            });

            if (!upstream.ok || !upstream.body) {
                const errorText = await upstream.text().catch(() => '<no body>');
                throw new Error(
                    `OpenRouter error ${upstream.status}: ${errorText.slice(0, 200)}`
                );
            }

            const pendingToolCalls: ToolCall[] = [];
            let loopContent = '';
            for await (const evt of parseOpenRouterSSE(upstream.body)) {
                await assertJobNotAborted({
                    provider: params.provider,
                    jobId: params.jobId,
                    abortSignal: params.abortSignal,
                });
                if (evt.type === 'text') {
                    fullContent += evt.text;
                    loopContent += evt.text;
                    chunks += 1;
                    emitJobDelta(params.jobId, evt.text, {
                        contentLength: fullContent.length,
                        chunksReceived: chunks,
                    });
                    await params.provider.updateJob(params.jobId, {
                        contentChunk: evt.text,
                        chunksReceived: chunks,
                    });
                }
                if (evt.type === 'tool_call') {
                    const toolCall = evt.tool_call;
                    pendingToolCalls.push(toolCall);
                    toolStates.set(toolCall.id, {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        status: 'loading',
                        args: toolCall.function.arguments,
                    });
                    await emitToolState();
                }
            }

            if (pendingToolCalls.length === 0) {
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
                let toolResultText = '';
                let status: 'complete' | 'error' | 'skipped' = 'complete';
                let errorMessage: string | undefined;

                if (runtimeHint === 'client') {
                    status = 'skipped';
                    errorMessage = `Tool \"${toolCall.function.name}\" is client-only.`;
                    toolResultText = errorMessage;
                } else {
                    const execution = await executeServerTool(
                        toolCall.function.name,
                        toolCall.function.arguments
                    );
                    if (execution.error) {
                        status = execution.runtime === 'client' ? 'skipped' : 'error';
                        errorMessage = execution.error;
                        toolResultText = `Error executing tool \"${toolCall.function.name}\": ${execution.error}`;
                    } else {
                        toolResultText = execution.result || '';
                    }
                }

                toolStates.set(toolCall.id, {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    status,
                    args: toolCall.function.arguments,
                    result: status === 'complete' ? toolResultText : undefined,
                    error: status !== 'complete' ? errorMessage : undefined,
                });
                await emitToolState();

                toolResultsForNextLoop.push({ call: toolCall, result: toolResultText });
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

            // If the caller forced a specific function, only enforce that on the first
            // turn; subsequent turns should allow the model to produce the final answer.
            if (isForcedFunctionToolChoice(activeToolChoice)) {
                activeToolChoice = 'auto';
            }

            if (loopIteration >= MAX_TOOL_ITERATIONS) {
                throw new Error(
                    `Background tool loop exceeded max iterations (${MAX_TOOL_ITERATIONS})`
                );
            }
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

        await params.provider.completeJob(params.jobId, fullContent);
        emitJobStatus(params.jobId, 'complete', {
            content: fullContent,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            tool_calls: Array.from(toolStates.values()),
        });

        if (shouldNotify()) {
            try {
                await notificationEmitter?.emitBackgroundJobComplete(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId
                );
            } catch (err) {
                console.error('[background-stream] Failed to emit notification:', err);
            }
        }
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
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

        if (shouldNotify()) {
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    err instanceof Error ? err.message : String(err)
                );
            } catch (notifyErr) {
                console.error('[background-stream] Failed to emit error notification:', notifyErr);
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
        ...cleanBody
    } = params.body;
    const toolRuntime =
        typeof _toolRuntime === 'object' && _toolRuntime !== null
            ? (_toolRuntime as Record<string, string>)
            : undefined;

    const hasTools =
        Array.isArray(cleanBody.tools) && cleanBody.tools.length > 0;
    if (hasTools) {
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
        });
        return;
    }

    const upstream = await fetch(OR_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'HTTP-Referer': params.referer,
            'X-Title': 'or3.chat',
        },
        body: JSON.stringify(cleanBody),
        signal: ac.signal,
    });

    if (!upstream.ok || !upstream.body) {
        const errorText = await upstream.text().catch(() => '<no body>');
        throw new Error(
            `OpenRouter error ${upstream.status}: ${errorText.slice(0, 200)}`
        );
    }

    await consumeBackgroundStream({
        jobId,
        stream: upstream.body,
        context: params,
        provider,
        shouldNotify: () => !hasJobViewers(jobId),
        flushOnEveryChunk: true,
        flushIntervalMs: 30,
    });
}

/**
 * Purpose:
 * Expose background streaming availability for route handlers.
 */
export function isBackgroundStreamingAvailable(): boolean {
    return isBackgroundStreamingEnabled();
}
