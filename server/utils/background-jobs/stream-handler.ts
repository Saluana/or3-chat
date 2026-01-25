/**
 * Background Streaming Handler
 *
 * Handles background mode streaming where the server continues
 * processing even after the client disconnects.
 */

import type { BackgroundJobProvider } from '../background-jobs/types';
import {
    getJobProvider,
    isBackgroundStreamingEnabled,
} from '../background-jobs/store';
import { checkJobAborted } from '../background-jobs/providers/convex';
import {
    parseOpenRouterSSE,
} from '~~/shared/openrouter/parseOpenRouterSSE';
import { emitBackgroundJobComplete, emitBackgroundJobError } from '../notifications/emit';

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface BackgroundStreamParams {
    body: Record<string, unknown>;
    apiKey: string;
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    referer: string;
}

export interface BackgroundStreamResult {
    jobId: string;
    status: 'streaming';
}

/**
 * Check if the request is for background mode
 */
export function isBackgroundModeRequest(body: Record<string, unknown>): boolean {
    return body._background === true;
}

/**
 * Validate background mode parameters
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
 * Start a background streaming job
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
    });

    // Fire-and-forget the streaming
    streamInBackground(jobId, params, provider).catch((err) => {
        console.error('[background-stream] Job failed:', jobId, err);
        void provider.failJob(jobId, err instanceof Error ? err.message : String(err));
    });

    return { jobId, status: 'streaming' };
}

/**
 * Consume a background stream and persist updates.
 * Can be used for background-only and hybrid (client-attached) streaming.
 */
export async function consumeBackgroundStream(params: {
    jobId: string;
    stream: ReadableStream<Uint8Array>;
    context: BackgroundStreamParams;
    provider: BackgroundJobProvider;
    shouldNotify?: () => boolean;
}): Promise<void> {
    let fullContent = '';
    let chunks = 0;
    const UPDATE_INTERVAL = 10; // Update provider every N chunks
    const isConvexProvider = params.provider.name === 'convex';
    const shouldNotify = params.shouldNotify ?? (() => true);

    try {
        for await (const evt of parseOpenRouterSSE(params.stream)) {
            if (evt.type === 'text') {
                fullContent += evt.text;
                chunks++;

                // Update provider periodically
                if (chunks % UPDATE_INTERVAL === 0) {
                    await params.provider.updateJob(params.jobId, {
                        contentChunk: evt.text,
                        chunksReceived: chunks,
                    });

                    // For Convex provider, poll for abort status
                    if (isConvexProvider) {
                        const aborted = await checkJobAborted(params.jobId);
                        if (aborted) {
                            throw new Error('Job aborted by user');
                        }
                    }
                }
            }
        }

        // Complete the job
        await params.provider.completeJob(params.jobId, fullContent);

        if (shouldNotify()) {
            // Emit server-side notification for job completion
            try {
                await emitBackgroundJobComplete(
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
                // Don't fail the job if notification fails
            }
        }

    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            // Job was aborted (already marked in provider)
            return;
        }
        
        if (shouldNotify()) {
            // Emit error notification
            try {
                await emitBackgroundJobError(
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
 * Stream in the background without client connection
 */
async function streamInBackground(
    jobId: string,
    params: BackgroundStreamParams,
    provider: BackgroundJobProvider
): Promise<void> {
    // Get abort controller if provider supports it (memory provider)
    const ac = provider.getAbortController?.(jobId) ?? new AbortController();

    // Strip internal fields from body before sending to OpenRouter
    const { _background, _threadId, _messageId, ...cleanBody } = params.body;

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
    });
}

/**
 * Check if background streaming is available
 */
export function isBackgroundStreamingAvailable(): boolean {
    return isBackgroundStreamingEnabled();
}
