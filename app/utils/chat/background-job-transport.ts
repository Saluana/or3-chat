/** Host job admission, status and browser-tool transport. */
import { shallowRef } from 'vue';
import { useRuntimeConfig } from '#imports';
import { hasCloudAccess } from '~/core/cloud/access';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { readRequestUsage, type RequestUsage } from '~~/shared/chat/compaction';
import { captureContextEnvelope, type ContextRequestPolicy } from '~~/shared/chat/context-budget';
import { normalizeError, presentError, parseRetryAfter } from '~~/shared/errors';
import type { ToolDefinition, ToolChoice } from './types';
import type { WorkflowMessageData } from './workflow-types';
import type { StreamedFieldMode } from '~~/shared/openrouter/parseOpenRouterSSE';
import type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';
import { abortableDelay, DEFAULT_BACKGROUND_START_TIMEOUT_MS, fetchWithResponseDeadline,
    OpenRouterTimeoutError, readResponseJsonWithIdleDeadline } from '~~/shared/openrouter/deadlines';
import { getDeviceId } from '~/core/sync/hlc';
import { isServerRouteAvailable, isMissingServerRoute, setServerRouteAvailable, assertDispatchOwner } from './server-route';
import { prepareOpenRouterRequest, type ORMessage, type OpenRouterRequestBody } from './openrouter-request';
import { openAiKeyHeaders } from '~/core/auth/useOpenAiKey';

/** Keep an uncertain admission in progress while the browser is offline. */
async function waitForOnline(signal?: AbortSignal): Promise<void> {
    if (typeof window === 'undefined' || navigator.onLine !== false) return;
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            window.removeEventListener('online', onOnline);
            signal?.removeEventListener('abort', onAbort);
        };
        const onOnline = () => { cleanup(); resolve(); };
        const onAbort = () => { cleanup(); reject(new DOMException('Admission cancelled', 'AbortError')); };
        window.addEventListener('online', onOnline);
        signal?.addEventListener('abort', onAbort);
        if (signal?.aborted) onAbort();
        else if (navigator.onLine) onOnline();
    });
}

function parseRetryAfterSeconds(value: string): number {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
    // Retry-After may also be an HTTP-date string; for our budget we treat
    // unparseable values as a small default.
    return 1;
}

export type BackgroundPollFailureKind =
    | 'transport'
    | 'rate_limit'
    | 'server'
    | 'not_found'
    | 'auth'
    | 'protocol';

export class BackgroundJobPollError extends Error {
    constructor(
        message: string,
        readonly kind: BackgroundPollFailureKind,
        readonly retryable: boolean,
        readonly statusCode?: number,
        readonly retryAfterMs?: number
    ) {
        super(message);
        this.name = 'BackgroundJobPollError';
    }
}

/**
 * Cache key for background streaming availability
 */
const BACKGROUND_STREAMING_CACHE_KEY = 'or3:background-streaming-available';

/**
 * Session-scoped override set when the server explicitly rejects background
 * execution. It beats explicit client config so a mismatched deployment does
 * not cause repeated admissions on every send. Reactive so computed gates
 * such as useAi's observe the refusal.
 */
const backgroundStreamingCapabilityDisabled = shallowRef(false);

/**
 * `BackgroundJobStatus`
 *
 * Purpose:
 * Represents background streaming job status from the server.
 */
export interface BackgroundJobStatus {
    id: string;
    status: 'streaming' | 'complete' | 'error' | 'aborted';
    threadId: string;
    messageId: string;
    model: string;
    chunksReceived: number;
    /** Durable execution attempt; increments after a worker takeover. */
    attempt?: number;
    /** Last measured provider request; prompt occupancy is never accumulated. */
    usage?: RequestUsage;
    startedAt: number;
    completedAt?: number;
    error?: string;
    content?: string;
    content_delta?: string;
    content_length?: number;
    /** Full reasoning snapshot when the server provides one. */
    reasoning_text?: string;
    reasoning_delta?: string;
    reasoning_length?: number;
    reasoning_reset?: boolean;
    /** Full content replaces a pre-recovery partial response. */
    content_reset?: boolean;
    /**
     * Client-side only. The server job may still be healthy; tracking was
     * interrupted by a connection/protocol/auth problem. Callers must not
     * treat this as an authoritative generation failure.
     */
    trackingInterrupted?: boolean;
    /**
     * Client-side only reason for `trackingInterrupted`. `missing` means the
     * job was confirmed gone and the row was durably projected as interrupted;
     * `auth` and `protocol` leave the row pending for reattachment retry.
     */
    trackingInterruptedKind?: 'missing' | 'auth' | 'protocol';
    tool_calls?: Array<{
        id?: string;
        name: string;
        status: 'loading' | 'complete' | 'error' | 'pending' | 'skipped';
        args?: string;
        result?: string;
        error?: string;
        runtime?: 'client' | 'server' | 'hybrid';
        /** Server metadata is validated against the call before display. */
        delegation?: import('~~/shared/chat/delegation-checkpoint').DelegationDisplayActivity;
        /** Length of the assistant text when this call's results arrived. */
        text_offset?: number;
    }>;
    workflow_state?: WorkflowMessageData;
}

/**
 * `BackgroundStreamResult`
 *
 * Purpose:
 * Return type for starting a background streaming job.
 */
export interface BackgroundStreamResult {
    jobId: string;
    status: 'streaming';
    /** Present for canonical chat admission; workflow jobs use another contract. */
    historyVersion?: 1;
}

/**
 * `BackgroundJobStreamEvent`
 *
 * Purpose:
 * SSE payload shape for background job updates.
 */
export type BackgroundJobStreamEvent = {
    event: 'snapshot' | 'delta' | 'status';
    status: BackgroundJobStatus;
};

function normalizeBackgroundJobUsage(status: BackgroundJobStatus): BackgroundJobStatus {
    const { usage: candidate, ...rest } = status;
    const usage = readRequestUsage(candidate);
    return { ...rest, ...(usage ? { usage } : {}) };
}

/** The original admission may still commit; retain its identity instead of inviting a new send. */
export class BackgroundAdmissionUncertainError extends Error {
    readonly backgroundAdmissionUncertain = true;
    readonly backgroundAdmissionRetryable = false;
    constructor(readonly admissionId: string, readonly workspaceId: string, cause?: unknown) {
        super('The server may still be running this response. Wait for it to reconnect before sending again.', { cause });
        this.name = 'BackgroundAdmissionUncertainError';
    }
}

type BackgroundAdmissionError = Error & {
    backgroundAdmissionRetryable?: boolean;
    backgroundCapabilityDisabled?: boolean;
    backgroundAdmissionUncertain?: boolean;
};

function makeBackgroundAdmissionError(
    message: string,
    options: { retryable: boolean; capabilityDisabled?: boolean }
): BackgroundAdmissionError {
    const error = new Error(message) as BackgroundAdmissionError;
    error.name = 'BackgroundAdmissionError';
    error.backgroundAdmissionRetryable = options.retryable;
    error.backgroundCapabilityDisabled = options.capabilityDisabled === true;
    return error;
}

async function readErrorPayload(
    response: Response
): Promise<{ error?: string; code?: string }> {
    const data = (await response.json().catch(() => null)) as unknown;
    if (data && typeof data === 'object') {
        const error = (data as { error?: unknown }).error;
        const code = (data as { code?: unknown }).code;
        return {
            error: typeof error === 'string' ? error : undefined,
            code: typeof code === 'string' ? code : undefined,
        };
    }
    return {};
}

async function readErrorMessage(
    response: Response,
    fallback: string
): Promise<string> {
    const payload = await readErrorPayload(response);
    return payload.error ?? fallback;
}

/**
 * `isBackgroundStreamingEnabled`
 *
 * Purpose:
 * Returns true when background streaming is available for this client.
 */
export function isBackgroundStreamingEnabled(
    configuredEnabled?: boolean
): boolean {
    if (backgroundStreamingCapabilityDisabled.value || !hasCloudAccess()) return false;
    const configEnabled =
        configuredEnabled ??
        (
            useRuntimeConfig() as {
                public?: { backgroundStreaming?: { enabled?: boolean } };
            }
        ).public?.backgroundStreaming?.enabled;
    // Explicit config wins over stale local caches. A stale "server route
    // unavailable" entry must not veto a Cloud instance that explicitly
    // enables background streaming.
    if (configEnabled === false) return false;
    if (configEnabled === true) return true;

    if (!isServerRouteAvailable()) return false;

    // Check cached result
    if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem(BACKGROUND_STREAMING_CACHE_KEY);
        if (cached === 'true') return true;
        if (cached === 'false') return false;
    }

    // Default: assume not available until first successful background request
    return false;
}

/**
 * Mark background streaming as available
 */
function setBackgroundStreamingAvailable(available: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BACKGROUND_STREAMING_CACHE_KEY, String(available));
}

/**
 * `startBackgroundStream`
 *
 * Purpose:
 * Starts a background streaming job and returns its job ID.
 */
export async function startBackgroundStream(params: {
    expectedProjectId?: string | null;
    projectContext?: import('~/utils/projects/types').ProjectContextSnapshot | null;
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    threadId: string;
    messageId: string;
    /** Stable admission identity; generated once per user-initiated send. */
    admissionId?: string;
    history: import('~~/shared/chat/background-history').ChatGenerationAdmissionEnvelope;
    reasoning?: OpenRouterReasoningConfig;
    tools?: ToolDefinition[];
    toolChoice?: ToolChoice;
    toolRuntime?: Record<string, string>;
    contextPolicy?: ContextRequestPolicy;
    delegationDefaults?: import('~~/shared/chat/delegation-checkpoint').DelegationDefaults;
    durableDelegation?: boolean;
    streamedFieldMode?: StreamedFieldMode;
    signal?: AbortSignal;
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
}): Promise<BackgroundStreamResult> {
    const body: OpenRouterRequestBody & {
        _background: true;
        _threadId: string;
        _messageId: string;
        _backgroundAdmissionId: string;
        _history: import('~~/shared/chat/background-history').ChatGenerationAdmissionEnvelope;
    } = {
        ...await prepareOpenRouterRequest(params),
        _background: true,
        _threadId: params.threadId,
        _messageId: params.messageId,
        // One admission ID per user-initiated send. Transport retries reuse
        // this body, while an explicit retry creates a fresh admission.
        _backgroundAdmissionId:
            params.admissionId && params.admissionId.length > 0
                ? params.admissionId
                : createRuntimeUuid(),
        _history: params.history,
        _clientDeviceId: getDeviceId(),
    };

    if (params.contextPolicy) body._context = captureContextEnvelope({ ...params.contextPolicy,
        requestedCompletionTokens: params.contextPolicy.requestedCompletionTokens });
    if (params.toolRuntime) {
        body._toolRuntime = params.toolRuntime;
    }
    if (params.delegationDefaults) body._delegationDefaults = params.delegationDefaults;
    if (params.durableDelegation) body._durableDelegation = 1;
    if (params.streamedFieldMode) {
        body._streamedFieldMode = params.streamedFieldMode;
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-or3-cloud-intent': 'mutation',
    };
    if (params.apiKey && useRuntimeConfig().public.ssrAuthEnabled !== true) {
        headers['x-or3-openrouter-key'] = params.apiKey;
    }
    Object.assign(headers, await openAiKeyHeaders(body.model));

    const serializedBody = JSON.stringify(body);
    let result: BackgroundStreamResult | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await waitForOnline(params.signal);
        await assertDispatchOwner(params);
        try {
            const resp = await fetchWithResponseDeadline('/api/openrouter/stream', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: serializedBody,
            }, {
                signal: params.signal,
                timeoutMs:
                    params.responseTimeoutMs ??
                    DEFAULT_BACKGROUND_START_TIMEOUT_MS,
            });

            if (!resp.ok) {
                const payload = await readErrorPayload(resp);
                const message =
                    payload.error ?? `Background stream failed: ${resp.status}`;
                if (payload.code === 'background_delegation_unsupported') {
                    throw makeBackgroundAdmissionError(message, { retryable: false });
                }
                if (
                    payload.code === 'background_streaming_disabled' ||
                    payload.code === 'background_history_unsupported' ||
                    payload.code === 'background_client_tool_unsupported'
                ) {
                    // Server explicitly rejected durable execution. Refresh the
                    // capability cache; do not retry and do not fall through to
                    // a different execution mode.
                    backgroundStreamingCapabilityDisabled.value = true;
                    setBackgroundStreamingAvailable(false);
                    setServerRouteAvailable(true);
                    throw makeBackgroundAdmissionError(message, {
                        retryable: false,
                        capabilityDisabled: true,
                    });
                }
                if (isMissingServerRoute(resp)) {
                    setServerRouteAvailable(false);
                    setBackgroundStreamingAvailable(false);
                }
                const metadata = normalizeError({ data: payload, status: resp.status,
                    retryAfterMs: parseRetryAfter(resp.headers.get('retry-after')) });
                const retryable = metadata.retryable === true;
                const error = makeBackgroundAdmissionError(presentError(metadata).message, { retryable });
                Object.assign(error, metadata);
                if (!retryable || attempt === 2) throw error;
                lastError = error;
            } else {
                // Strict admission contract: `_background: true` must return a
                // JSON `{ jobId, status: 'streaming' }` body. An unexpected SSE
                // or malformed body means a mismatched deployment; reject it
                // instead of silently launching another execution mode.
                const contentType = resp.headers.get('content-type') ?? '';
                if (!contentType.includes('application/json')) {
                    throw Object.assign(makeBackgroundAdmissionError(
                        'Background admission returned a non-JSON response',
                        { retryable: false }
                    ), { backgroundAdmissionUncertain: true });
                }
                let decoded: unknown;
                try {
                    decoded = await readResponseJsonWithIdleDeadline<unknown>(
                        resp,
                        {
                            signal: params.signal,
                            timeoutMs: params.idleTimeoutMs,
                        }
                    );
                } catch (decodeError) {
                    if (params.signal?.aborted) throw decodeError;
                    throw Object.assign(makeBackgroundAdmissionError(
                        decodeError instanceof Error
                            ? decodeError.message
                            : 'Malformed background admission response',
                        { retryable: false }
                    ), { backgroundAdmissionUncertain: true });
                }
                const candidate =
                    decoded && typeof decoded === 'object'
                        ? (decoded as { jobId?: unknown; status?: unknown; historyVersion?: unknown })
                        : null;
                if (
                    !candidate ||
                    typeof candidate.jobId !== 'string' ||
                    candidate.jobId.length === 0 ||
                    candidate.status !== 'streaming' ||
                    candidate.historyVersion !== 1
                ) {
                    throw Object.assign(makeBackgroundAdmissionError(
                        'Malformed background admission response',
                        { retryable: false }
                    ), { backgroundAdmissionUncertain: true });
                }
                result = {
                    jobId: candidate.jobId,
                    status: 'streaming',
                    historyVersion: 1,
                };
                break;
            }
        } catch (error) {
            if (params.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            const admissionError = error as BackgroundAdmissionError | null | undefined;
            if (admissionError?.backgroundAdmissionRetryable === false && !admissionError.backgroundAdmissionUncertain) {
                throw error;
            }
            lastError = error;
            if (attempt === 2 || admissionError?.backgroundAdmissionUncertain) break;
        }
        await abortableDelay(150 * 2 ** attempt, params.signal);
    }
    if (!result) {
        try {
            await assertDispatchOwner(params);
            const recovered = await recoverBackgroundJob(
                body._backgroundAdmissionId, params.history.workspaceId, {
                    signal: params.signal,
                    responseTimeoutMs: params.responseTimeoutMs,
                    idleTimeoutMs: params.idleTimeoutMs,
                });
            // Admission acknowledges identity, not current liveness. Terminal jobs
            // also attach so their authoritative result is not lost or resubmitted.
            if (recovered && recovered.threadId === params.threadId && recovered.messageId === params.messageId) {
                await assertDispatchOwner(params);
                if (params.signal?.aborted) throw new DOMException('Admission cancelled', 'AbortError');
                setBackgroundStreamingAvailable(true);
                return { jobId: recovered.jobId, status: 'streaming', historyVersion: 1 };
            }
        } catch (error) {
            if (params.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            throw new BackgroundAdmissionUncertainError(body._backgroundAdmissionId, params.history.workspaceId, error);
        }
        throw new BackgroundAdmissionUncertainError(
            body._backgroundAdmissionId, params.history.workspaceId, lastError);
    }

    // Mark background streaming as available since it worked
    setBackgroundStreamingAvailable(true);

    return result;
}

/**
 * Look up a committed canonical admission in its originating workspace.
 * A 404 means no row exists at lookup time; an earlier request may still commit.
 * Transport/auth/provider failures never prove absence.
 */
export async function recoverBackgroundJob(
    admissionId: string,
    workspaceId: string,
    options: { signal?: AbortSignal; responseTimeoutMs?: number; idleTimeoutMs?: number } = {}
): Promise<{ jobId: string; status: BackgroundJobStatus['status']; threadId: string; messageId: string; historyVersion: 1 } | null> {
    if (!admissionId || !workspaceId) return null;
    const signal = options.signal;
    const query = new URLSearchParams({ workspaceId });
    const response = await fetchWithResponseDeadline(
        `/api/jobs/admission/${encodeURIComponent(admissionId)}?${query}`,
        { credentials: 'include', cache: 'no-store' },
        { signal, timeoutMs: options.responseTimeoutMs ?? 3_000 }
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Admission recovery failed: ${response.status}`);
    const result = await readResponseJsonWithIdleDeadline<{
        jobId?: unknown; status?: unknown; threadId?: unknown; messageId?: unknown; historyVersion?: unknown;
    } | null>(response, { signal, timeoutMs: options.idleTimeoutMs ?? 3_000 });
    if (!result || typeof result.jobId !== 'string' || !result.jobId ||
        typeof result.threadId !== 'string' || typeof result.messageId !== 'string' ||
        result.historyVersion !== 1 ||
        !['streaming', 'complete', 'error', 'aborted'].includes(String(result.status))) {
        throw new Error('Malformed admission recovery response');
    }
    return { jobId: result.jobId, status: result.status as BackgroundJobStatus['status'],
        threadId: result.threadId, messageId: result.messageId, historyVersion: 1 };
}

/**
 * `pollJobStatus`
 *
 * Purpose:
 * Polls the status of a background streaming job.
 */
export async function pollJobStatus(
    jobId: string,
    offset?: number,
    signal?: AbortSignal,
    attempt?: number
): Promise<BackgroundJobStatus> {
    const query = new URLSearchParams();
    if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
        query.set('offset', String(Math.floor(offset)));
    }
    if (
        typeof attempt === 'number' &&
        Number.isFinite(attempt) &&
        attempt >= 0
    ) {
        query.set('attempt', String(Math.floor(attempt)));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const url = `/api/jobs/${jobId}/status${suffix}`;
    let resp: Response;
    try {
        resp = await fetchWithResponseDeadline(url, {}, { signal });
    } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw error;
        }
        throw new BackgroundJobPollError(
            error instanceof Error ? error.message : 'Job status transport failed',
            'transport',
            true
        );
    }

    if (!resp.ok) {
        const message = await readErrorMessage(
            resp,
            `Job status failed: ${resp.status}`
        );
        const retryAfter = resp.headers.get('retry-after');
        const retryAfterMs = retryAfter
            ? Math.min(30_000, Math.max(0, parseRetryAfterSeconds(retryAfter) * 1_000))
            : undefined;
        const kind: BackgroundPollFailureKind =
            resp.status === 429
                ? 'rate_limit'
                : resp.status >= 500
                    ? 'server'
                    : resp.status === 404
                        ? 'not_found'
                        : resp.status === 401 || resp.status === 403
                            ? 'auth'
                            : 'protocol';
        throw new BackgroundJobPollError(
            message,
            kind,
            kind !== 'protocol',
            resp.status,
            retryAfterMs
        );
    }

    let decoded: unknown;
    try {
        decoded = await readResponseJsonWithIdleDeadline<unknown>(resp, {
            signal,
        });
    } catch (error) {
        if (
            signal?.aborted ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            throw error;
        }
        // Body timeouts and malformed payloads are transport/provider problems,
        // not authoritative job states. Classify them so callers retry instead
        // of fabricating a terminal generation failure.
        if (error instanceof OpenRouterTimeoutError) {
            throw new BackgroundJobPollError(error.message, 'transport', true);
        }
        throw new BackgroundJobPollError(
            error instanceof Error
                ? error.message
                : 'Job status response decode failed',
            'protocol',
            false
        );
    }
    if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof (decoded as { status?: unknown }).status !== 'string'
    ) {
        throw new BackgroundJobPollError(
            'Malformed job status response',
            'protocol',
            false
        );
    }
    return normalizeBackgroundJobUsage(decoded as BackgroundJobStatus);
}

/**
 * `abortBackgroundJob`
 *
 * Purpose:
 * Requests abortion of a background streaming job.
 */
export type BackgroundAbortState = 'aborted' | 'not_found' | 'already_terminal' | 'abort_rejected' | 'abort_error' | 'cancel_requested';

export async function abortBackgroundJob(
    jobId: string,
    onOutcome?: (state: BackgroundAbortState) => void
): Promise<boolean> {
    const resp = await fetch(`/api/jobs/${jobId}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
        body: '{}',
    });

    const result = await resp.json().catch(() => null) as { aborted?: boolean; state?: BackgroundAbortState } | null;
    const state = result?.state ?? (resp.ok && result?.aborted === true ? 'aborted' : 'abort_error');
    onOutcome?.(state);
    return resp.ok && result?.aborted === true && state === 'aborted';
}

export type BackgroundClientToolClaim = {
    claimToken: string;
    claimDigest: string;
    claimExpiresAt: number;
    call: {
        id: string;
        name: string;
        arguments: string;
        argumentFingerprint: string;
        definition: ToolDefinition;
    };
    context: { workspaceId: string; threadId: string; messageId: string };
    parentModel?: { model: string; thinking: boolean; reasoningEffort?: string | null };
};

/** Fresh server check before a browser tool handler; never call in a storage transaction. */
export async function validateBackgroundClientToolClaim(params: {
    jobId: string; callId: string; claimToken: string; signal?: AbortSignal;
}): Promise<void> {
    const response = await fetchWithResponseDeadline(`/api/jobs/${encodeURIComponent(params.jobId)}/client-tool/validate`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-or3-tool-intent': 'validate' },
        body: JSON.stringify({ callId: params.callId, claimToken: params.claimToken }),
    }, { signal: params.signal, timeoutMs: 5000 });
    if (!response.ok) throw new Error('Tool approval expired or is no longer authorized.');
    const body = await readResponseJsonWithIdleDeadline<{ valid?: unknown } | null>(response, { signal: params.signal, timeoutMs: 5000 });
    if (body?.valid !== true) throw new Error('Tool approval could not be verified.');
}

export async function claimBackgroundClientTool(
    jobId: string,
    callId: string
): Promise<BackgroundClientToolClaim | null> {
    const response = await fetch(`/api/jobs/${jobId}/client-tool/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-OR3-Tool-Intent': 'claim',
        },
        body: JSON.stringify({ callId, deviceId: getDeviceId() }),
    });
    if (response.status === 409) return null;
    if (!response.ok) throw new Error(`Client tool claim failed: ${response.status}`);
    return (await response.json()) as BackgroundClientToolClaim;
}

/** Defaults capture and durable delegation are independently versioned. */
export async function getBackgroundClientToolCapability(signal?: AbortSignal): Promise<{ available: boolean; defaultsCapture: boolean; durableDelegation: boolean; serverModelSearch: boolean }> {
    try {
        const response = await fetchWithResponseDeadline(
            '/api/jobs/client-tool/capability',
            { credentials: 'include', cache: 'no-store' },
            { signal, timeoutMs: 3_000 }
        );
        if (!response.ok) return { available: false, defaultsCapture: false, durableDelegation: false, serverModelSearch: false };
        const body = await readResponseJsonWithIdleDeadline<{ available?: unknown; delegationDefaultsCaptureVersion?: unknown; durableDelegationVersion?: unknown; serverModelSearchVersion?: unknown } | null>(response,
            { signal, timeoutMs: 3_000 });
        return { available: body?.available === true, defaultsCapture: body?.delegationDefaultsCaptureVersion === 1,
            durableDelegation: body?.durableDelegationVersion === 1, serverModelSearch: body?.serverModelSearchVersion === 1 };
    } catch (error) {
        if (signal?.aborted) throw error;
        return { available: false, defaultsCapture: false, durableDelegation: false, serverModelSearch: false };
    }
}

export async function isBackgroundClientToolBridgeAvailable(): Promise<boolean> {
    return (await getBackgroundClientToolCapability()).available;
}

export async function submitBackgroundClientToolResult(params: {
    jobId: string;
    callId: string;
    claimToken: string;
    result?: string;
    error?: string;
}): Promise<void> {
    const response = await fetch(`/api/jobs/${params.jobId}/client-tool/result`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-OR3-Tool-Intent': 'result',
        },
        body: JSON.stringify({
            callId: params.callId,
            claimToken: params.claimToken,
            result: params.result,
            error: params.error,
        }),
    });
    if (!response.ok) {
        throw new Error(`Client tool result failed: ${response.status}`);
    }
}

/**
 * `abortBackgroundAdmission`
 *
 * Purpose:
 * Cancels a background admission before its job ID is known, using the stable
 * admission ID. The server either aborts the committed job or records a
 * cancellation marker consumed when the admission commits.
 */
export async function abortBackgroundAdmission(
    admissionId: string,
    workspaceId: string | undefined
): Promise<{ aborted: boolean; pending: boolean; jobId?: string; state?: BackgroundAbortState }> {
    let resp: Response;
    try {
        resp = await fetch('/api/jobs/admission-abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            credentials: 'include',
            body: JSON.stringify({ admissionId, workspaceId }),
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw new BackgroundJobPollError(
            error instanceof Error
                ? error.message
                : 'Admission cancellation transport failed',
            'transport',
            true
        );
    }
    if (!resp.ok) {
        throw new BackgroundJobPollError(
            `Admission cancellation failed: ${resp.status}`,
            resp.status === 401 || resp.status === 403 ? 'auth' : 'transport',
            resp.status >= 500 || resp.status === 429
        );
    }
    const result = (await resp.json().catch(() => null)) as {
        aborted?: boolean;
        pending?: boolean;
        jobId?: string;
        state?: BackgroundAbortState;
    } | null;
    if (!result || typeof result !== 'object') {
        throw new BackgroundJobPollError(
            'Malformed admission cancellation response',
            'protocol',
            false
        );
    }
    return {
        aborted: result.aborted === true,
        pending: result.pending === true,
        state: result.state,
        jobId: typeof result.jobId === 'string' ? result.jobId : undefined,
    };
}

/**
 * `subscribeBackgroundJobStream`
 *
 * Purpose:
 * Subscribes to background job updates via SSE.
 */
export function subscribeBackgroundJobStream(params: {
    jobId: string;
    offset?: number;
    attempt?: number;
    onStatus: (status: BackgroundJobStatus) => void;
    onError?: (error: Error) => void;
}): () => void {
    if (typeof EventSource === 'undefined') {
        throw new Error('EventSource unavailable');
    }
    const offset =
        typeof params.offset === 'number' && Number.isFinite(params.offset)
            ? Math.max(0, Math.floor(params.offset))
            : null;
    const query = new URLSearchParams();
    if (offset !== null) query.set('offset', String(offset));
    if (
        typeof params.attempt === 'number' &&
        Number.isFinite(params.attempt) &&
        params.attempt >= 0
    ) {
        query.set('attempt', String(Math.floor(params.attempt)));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const url = `/api/jobs/${params.jobId}/stream${suffix}`;

    const es = new EventSource(url);
    let receivedTerminal = false;

    es.onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data) as BackgroundJobStreamEvent;
            const status = normalizeBackgroundJobUsage(parsed.status);
            if (status.status !== 'streaming') {
                receivedTerminal = true;
                es.close();
            }
            params.onStatus(status);
        } catch (err) {
            if (params.onError) {
                params.onError(
                    err instanceof Error ? err : new Error('Invalid SSE payload')
                );
            }
        }
    };

    es.onerror = () => {
        if (!receivedTerminal && params.onError) {
            params.onError(new Error('Background SSE connection failed'));
        }
    };

    return () => {
        try {
            es.close();
        } catch {
            /* intentionally empty */
        }
    };
}
