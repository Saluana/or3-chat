import { retainBackgroundToolResult } from './history';
import { getChatJobExecution } from './types';
import { serializeError, normalizeError, presentError, parseRetryAfter } from '~~/shared/errors';
import { OpenRouterStreamError, normalizeProviderResponseError } from '~~/shared/openrouter/errors';
import { attachRequestUsage, captureUsagePrefix, type UsagePrefix } from '~~/shared/chat/request-usage';
import { readRequestUsage } from '~~/shared/chat/compaction';
import type { CountableChatMessage, ContextRequestPolicy } from '~~/shared/chat/context-budget';
import { captureContextEnvelope } from '~~/shared/chat/context-budget';
import { resolveServerContextPolicy, admitServerProviderBody, withoutOr3RequestMetadata } from '../chat/context-admission';
import { countTokensApprox } from '~/utils/chat/tokens';
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
import type {
    BackgroundJobExecution,
    BackgroundJobProvider,
    DurableBackgroundJobProvider,
    TerminalGenerationSnapshot,
} from '../background-jobs/types';
import {
    getBackgroundJobEncryptionKey,
    getJobProvider,
    isBackgroundStreamingEnabled,
} from '../background-jobs/store';
import { encryptBackgroundCredential } from './crypto';
import { getScopedAdmissionKey, hasAdmissionCancelled } from './admission-cancels';
import { AdmissionCancelledError } from './types';
import { claimAndRunBackgroundJob } from './lifecycle';
import { supportsClientToolHandoff, supportsDelegationCoordination, supportsDelegationHistory, supportsDurableBackgroundJobs } from './capabilities';
import { DelegationPreparationError, prepareDelegationWait } from './delegation-prepare';
import { getSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getShutdownRuntime } from '../shutdown/runtime';
import {
    parseOpenRouterSSE,
    type StreamedFieldMode,
} from '~~/shared/openrouter/parseOpenRouterSSE';
import { getNotificationEmitter } from '../notifications/registry';
import {
    emitJobDelta,
    emitJobReasoningDelta,
    emitJobStatus,
    hasJobViewers,
    initJobLiveState,
    pauseJobLiveState,
} from './viewers';
import { logBackgroundEvent } from './logging';
import type { ToolCall, ToolDefinition } from '~/utils/chat/types';
import { executeServerTool, getServerTool } from '../chat/tool-registry';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';
import { MAX_TOOL_ITERATIONS } from '~/utils/chat/constants';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import {
    emitBackgroundJobWebhookEvent,
    emitMessageCompletedWebhookEvent,
} from '../webhooks/hook-emissions';
import { snapshotToolDefinitions, toolDefinitionEquals } from '~~/shared/chat/tool-policy';
import { validateToolDefinitions } from '~~/shared/chat/tool-schema';
import { sensitiveValueMetadata } from '~~/shared/logging/sensitive-metadata';
import {
    MAX_CANONICAL_MESSAGE_OUTPUT_BYTES,
    projectToolResult,
    utf8Bytes,
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
import { sendWithAffordableReply } from '~~/shared/openrouter/credit-retry';
import { classifyDelegationDispatchFailure } from './model-dispatch';
import { DelegationDefaultsSchema, DelegationDispatchSchema } from '~~/shared/chat/delegation-checkpoint';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { prepareBackgroundHistory } from './admission-history';
import {
    assertBackgroundHistoryProvider,
    reconcileBackgroundJobHistory,
} from './history';
import { createContinuationDeltaNormalizer } from '~~/shared/chat/continuation';
import { canonicalHistoryContext } from '../chat/canonical-history-context';
import { createHistoryRetrievalService } from '~~/shared/chat/history-retrieval';
import { HISTORY_TOOL_NAMES } from '~~/shared/chat/history-tools';

function createAbortError(message = 'Job aborted by user'): Error {
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
}

function isBackgroundJobLeaseLost(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === 'BackgroundJobLeaseLostError' ||
            error.message === 'Background job lease was superseded')
    );
}

function createBackgroundJobLeaseLostError(): Error {
    const error = new Error('Background job lease was superseded');
    error.name = 'BackgroundJobLeaseLostError';
    return error;
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

/** Persist evidence after authorization and immediately before the paid request. */
async function beginDelegationDispatch(jobId: string, context: BackgroundStreamParams, provider: BackgroundJobProvider) {
    const execution = context.execution;
    if (!execution || execution.delegationRecoveryPolicy === undefined) return;
    if (execution.delegationRecoveryPolicy !== 'v1' || !context.leaseOwner || !provider.beginDelegationDispatch)
        throw new Error('Durable model dispatch is unavailable.');
    if (execution.delegationDispatch !== undefined)
        throw Object.assign(new Error('Model request outcome is unknown.'), { code: 'ERR_MODEL_OUTCOME_UNKNOWN', retryable: false });
    const previousSequence = execution.delegationDispatchSequence ?? 0;
    if (!Number.isSafeInteger(previousSequence) || previousSequence < 0 || previousSequence >= Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid durable model dispatch sequence.');
    const marker = await provider.beginDelegationDispatch(jobId, context.leaseOwner);
    if (!marker) throw createBackgroundJobLeaseLostError();
    if (!DelegationDispatchSchema.safeParse(marker).success || marker.sequence !== previousSequence + 1)
        throw new Error('Invalid durable model dispatch marker.');
    context.execution = { ...execution, delegationDispatchSequence: marker.sequence, delegationDispatch: marker };
    // Stop or another worker can win while the marker write is in flight.
    // Re-read the fence before sending; a marker alone does not grant a lease.
    const current = await provider.getJob(jobId, context.userId);
    if (!current) throw createBackgroundJobLeaseLostError();
    const currentExecution = getChatJobExecution(current);
    if (current.status !== 'streaming' || currentExecution?.cancellationRequestedAt !== undefined)
        throw createAbortError();
    const currentMarker = DelegationDispatchSchema.safeParse(currentExecution?.delegationDispatch);
    if (!currentExecution || current.leaseOwner !== context.leaseOwner ||
        (current.leaseExpiresAt ?? 0) <= Date.now() || current.historyPhase !== 'ready' ||
        currentExecution.delegationRecoveryPolicy !== 'v1' || !currentMarker.success ||
        currentMarker.data.sequence !== marker.sequence) throw createBackgroundJobLeaseLostError();
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
    credentialSource?: 'personal' | 'server';
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    referer: string;
    /** Persisted recovery input associated with the current worker claim. */
    execution?: BackgroundJobExecution;
    /** Durable lease owner used to fence provider writes. */
    leaseOwner?: string;
    /** Immutable attempt of this worker, also fences process-local projections. */
    attempt?: number;
    /** Internal, independently resolved facts; never accepted from the wire or persisted as authority. */
    contextPolicy?: ContextRequestPolicy;
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
    historyVersion: 1;
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
/** Persist a fenced terminal snapshot before announcing completion. */
async function persistTerminalGenerationSnapshot(
    provider: DurableBackgroundJobProvider,
    jobId: string,
    snapshot: TerminalGenerationSnapshot,
    leaseOwner?: string
): Promise<void> {
    try {
        const saved = await provider.saveTerminalSnapshot(jobId, snapshot, leaseOwner);
        if (!saved) throw createBackgroundJobLeaseLostError();
    } catch (error) {
        if (isBackgroundJobLeaseLost(error)) throw error;
        logBackgroundEvent('warn', 'background.chat.snapshot.save_failed', {
            jobId, status: snapshot.status,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

/** Only provider-visible fields enter the request fingerprint. */
async function captureBackgroundUsagePrefix(body: Record<string, unknown>): Promise<UsagePrefix | undefined> {
    const { messages, ...configuration } = body;
    return captureUsagePrefix({
        model: typeof body.model === 'string' ? body.model : '',
        messages: Array.isArray(messages) ? messages as CountableChatMessage[] : [],
        tools: Array.isArray(body.tools) ? body.tools : undefined,
        modalities: Array.isArray(body.modalities) ? body.modalities as string[] : undefined,
        configuration,
        countText: countTokensApprox,
    }).catch(() => undefined);
}

export async function startBackgroundStream(
    params: BackgroundStreamParams
): Promise<BackgroundStreamResult> {
    // Preserve captured choices and bytes before provider/auth/history awaits.
    params = { ...params, body: JSON.parse(JSON.stringify(params.body)) as Record<string, unknown> };
    const contextPolicy = params.contextPolicy ?? await resolveServerContextPolicy(params.body, params.apiKey, useRuntimeConfig().openrouterBaseUrl);
    const prepared = await admitServerProviderBody(withoutOr3RequestMetadata(params.body), contextPolicy);
    params.body = { ...params.body, ...prepared };
    if (contextPolicy) params.body._context = captureContextEnvelope(contextPolicy);
    let delegationDefaults: BackgroundJobExecution['delegationDefaults'];
    if (params.body._delegationDefaults !== undefined) {
        const parsed = DelegationDefaultsSchema.safeParse(params.body._delegationDefaults);
        const prefix = parsed.success && Array.isArray(params.body.messages)
            ? DelegationDefaultsSchema.safeParse({ version: 1, instructions: params.body.messages.slice(0, parsed.data.instructions.length) })
            : null;
        if (!parsed.success || !prefix?.success || JSON.stringify(prefix.data.instructions) !== JSON.stringify(parsed.data.instructions)) {
            const error = new Error('Delegation defaults must match the admitted instructions.');
            error.name = 'BackgroundDelegationDefaultsError';
            throw error;
        }
        delegationDefaults = parsed.data;
    }
    const provider = await getJobProvider();
    if (!supportsDurableBackgroundJobs(provider)) {
        const error = new Error(
            `Background job provider "${provider.name}" does not support durable canonical recovery`
        );
        error.name = 'BackgroundHistoryUnsupportedError';
        throw error;
    }
    const requestedRuntimes = params.body._toolRuntime;
    if (
        requestedRuntimes &&
        typeof requestedRuntimes === 'object' &&
        Object.values(requestedRuntimes).includes('client') &&
        !supportsClientToolHandoff(provider)
    ) {
        const error = new Error(
            `Background job provider "${provider.name}" does not support browser tool handoff`
        );
        error.name = 'BackgroundClientToolUnsupportedError';
        throw error;
    }
    const encryptionKey = getBackgroundJobEncryptionKey();
    const syncProviderId = String(
        (
            useRuntimeConfig().public as {
                sync?: { provider?: string };
            }
        ).sync?.provider ?? ''
    );
    const admissionId =
        typeof params.body._backgroundAdmissionId === 'string' &&
        params.body._backgroundAdmissionId.trim() &&
        params.body._backgroundAdmissionId.length <= 128
            ? params.body._backgroundAdmissionId.trim()
            : params.messageId;
    const history = prepareBackgroundHistory(params.body._history, { admissionId, syncProviderId,
        workspaceId: params.workspaceId, threadId: params.threadId, messageId: params.messageId });
    assertBackgroundHistoryProvider(syncProviderId);
    const { assertServerProjectExecutionSupported } = await import('../chat/project-policy');
    const hints = params.body._toolRuntime && typeof params.body._toolRuntime === 'object'
        ? params.body._toolRuntime as Record<string, unknown> : {};
    const definitions = Array.isArray(params.body.tools) ? params.body.tools as ToolDefinition[] : [];
    const durableDelegationRequested = params.body._durableDelegation !== undefined;
    if (durableDelegationRequested) {
        const unsupported = () => {
            const error = new Error('Durable delegation is unavailable for this request or deployment.');
            error.name = 'BackgroundDurableDelegationUnsupportedError';
            return error;
        };
        const tools = validateToolDefinitions(params.body.tools);
        const context = params.body._context;
        const modalities = params.body.modalities;
        const runtimes = params.body._toolRuntime;
        if (params.body._durableDelegation !== 1 || !supportsDelegationCoordination(provider) ||
            !supportsDelegationHistory(getSyncGatewayAdapter(syncProviderId)) || !delegationDefaults ||
            !context || typeof context !== 'object' || Array.isArray(context) || (context as Record<string, unknown>).version !== 1 ||
            (modalities !== undefined && (!Array.isArray(modalities) || modalities.length !== 1 || modalities[0] !== 'text')) ||
            !tools.valid || !tools.value.some(tool => tool.function.name === DELEGATE_CHAT_TOOL) ||
            !runtimes || typeof runtimes !== 'object' || Array.isArray(runtimes) || hints[DELEGATE_CHAT_TOOL] !== 'client' ||
            !getShutdownRuntime().controller.canStartWork()) throw unsupported();
        const names = new Set(tools.value.map(tool => tool.function.name));
        if (Object.entries(hints).some(([name, runtime]) => !names.has(name) || !['client', 'server', 'hybrid'].includes(String(runtime))))
            throw unsupported();
        for (const tool of tools.value) {
            const name = tool.function.name;
            if (name === DELEGATE_CHAT_TOOL) continue;
            const registered = getServerTool(name);
            if (hints[name] === 'client' || !registered || registered.runtime === 'client' ||
                !toolDefinitionEquals(registered.definition, tool)) throw unsupported();
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Request tool definitions have not yet passed runtime validation.
    if (definitions.some((tool) => HISTORY_TOOL_NAMES.some((name) => tool.function?.name === name) && hints[tool.function.name] !== 'client')) {
        const context = canonicalHistoryContext({ subject: params.userId, workspaceId: params.workspaceId,
            threadId: params.threadId, syncProviderId, signal: AbortSignal.timeout(10_000) });
        if ((await createHistoryRetrievalService().inspect(context)).status !== 'ok') {
            const error = new Error('Canonical compaction scope is unavailable. Use the browser bridge or foreground retrieval.');
            error.name = 'BackgroundHistoryUnsupportedError'; throw error;
        }
    }
    const executionBody = { ...params.body };
    delete executionBody._history;
    delete executionBody._delegationDefaults;
    delete executionBody._durableDelegation;
    const execution: BackgroundJobExecution = {
        version: 1,
        credentialSource: params.credentialSource,
        body: executionBody,
        workspaceId: params.workspaceId,
        referer: params.referer,
        apiKeyCiphertext: encryptBackgroundCredential(
            params.apiKey,
            encryptionKey
        ),
        history,
        ...(delegationDefaults ? { delegationDefaults } : {}),
        ...(durableDelegationRequested ? { delegationRecoveryPolicy: 'v1' as const } : {}),
        contentBase:
            history.kind === 'continuation'
                ? String(
                      (history.assistantMessage.data as
                          | Record<string, unknown>
                          | undefined)?.content ?? ''
                  )
                : '',
        reasoningBase:
            history.kind === 'continuation'
                ? String(
                      (history.assistantMessage.data as
                          | Record<string, unknown>
                          | undefined)?.reasoning_text ?? ''
                  )
                : '',
        continuation:
            history.kind === 'continuation' ? { prefix: '>>' } : undefined,
        checkpointedToolCallIds: [],
    };
    const model = (params.body.model as string) || 'unknown';

    // Bind admission and cancellation atomically through the provider's existing key.
    const admissionKey = getScopedAdmissionKey(params.userId, params.workspaceId, admissionId);
    if (hasAdmissionCancelled(admissionKey)) throw new AdmissionCancelledError(admissionId);

    // Create job
    const jobId = await provider.createJob({
        userId: params.userId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
        kind: 'chat',
        idempotencyKey: admissionKey,
        generationId: history.generationId,
        syncProviderId,
        historyPhase: 'admission_pending',
        initialContent: execution.contentBase,
        initialReasoning: execution.reasoningBase,
        execution,
    });
    if (hasAdmissionCancelled(admissionKey)) {
        await provider.abortJob(jobId, params.userId);
        throw new AdmissionCancelledError(admissionId);
    }
    const created = await provider.getJob(jobId, params.userId);
    if (!created) throw new Error('Background job disappeared during admission');
    if (durableDelegationRequested && getChatJobExecution(created)?.delegationRecoveryPolicy !== 'v1') {
        const error = new Error('This admission already belongs to a different execution mode.');
        error.name = 'BackgroundHistoryAdmissionError';
        throw error;
    }
    const historyResult = await reconcileBackgroundJobHistory(provider, created);
    if (
        historyResult !== 'ready' &&
        historyResult !== 'committed' &&
        historyResult !== 'superseded' &&
        created.historyPhase !== 'ready' &&
        created.historyPhase !== 'committed' &&
        created.historyPhase !== 'superseded'
    ) {
        const error = new Error('Background history admission did not become ready');
        if (historyResult === 'blocked') {
            error.name = 'BackgroundHistoryAdmissionError';
        }
        throw error;
    }
    // First-turn ownership exists canonically only after admission. Refusing
    // execution must also leave the admitted job terminal rather than stranded.
    try {
        await assertServerProjectExecutionSupported({ subject: params.userId, workspaceId: params.workspaceId, threadId: params.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
    } catch (error) {
        await persistTerminalGenerationSnapshot(provider, jobId, { status: 'error',
            content: execution.contentBase ?? '', reasoning: execution.reasoningBase ?? '',
            error: error instanceof Error ? error.message : String(error), completedAt: Date.now() });
        throw error;
    }
    logBackgroundEvent('info', 'background.chat.started', {
        jobId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        model,
        hasTools: Array.isArray(params.body.tools) && params.body.tools.length > 0,
    });

    // Claiming is atomic. A duplicate admission returns the existing job ID,
    // while only one process can own and execute its lease.
    await claimAndRunBackgroundJob(jobId, {
        provider,
        encryptionKey,
        execute: executeBackgroundJob,
    });

    return { jobId, status: 'streaming', historyVersion: 1 };
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
    provider: DurableBackgroundJobProvider;
    shouldNotify?: () => boolean;
    streamedFieldMode?: StreamedFieldMode;
    usagePrefix?: UsagePrefix;
}): Promise<void> {
    const usagePrefix = params.usagePrefix ?? await captureBackgroundUsagePrefix(params.context.body);
    const usageRequestId = crypto.randomUUID();
    const initialJob = await params.provider.getJob(params.jobId, params.context.userId);
    const attempt = params.context.attempt ?? initialJob?.attempts;
    let requestUsage = readRequestUsage(initialJob?.usage);
    const contentBase = params.context.execution?.contentBase ?? '';
    const reasoningBase = params.context.execution?.reasoningBase ?? '';
    const continuationNormalizer = params.context.execution?.continuation
        ? createContinuationDeltaNormalizer(
              contentBase,
              params.context.execution.continuation.prefix
          )
        : null;
    let fullContent = contentBase;
    let fullReasoning = reasoningBase;
    let chunks = 0;
    const remainingOutputBytes = Math.max(
        0,
        MAX_CANONICAL_MESSAGE_OUTPUT_BYTES -
            utf8Bytes(contentBase) -
            utf8Bytes(reasoningBase)
    );
    let normalizedState = beginNormalizedIteration(
        createNormalizedStreamState({
            outputLimitBytes: remainingOutputBytes,
        })
    );
    const UPDATE_BUFFER_CHARS = 16 * 1024;
    const UPDATE_INTERVAL_MS = 500;
    const notificationEmitter = getNotificationEmitter(params.provider.name);
    const shouldNotify = params.shouldNotify ?? (() => true);
    let pendingChunk = '';
    let pendingReasoning = '';
    let lastUpdateAt = Date.now();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushScheduled = false;
    let flushInFlight = Promise.resolve();
    let flushError: unknown = null;

    initJobLiveState(params.jobId, { contentBase, reasoningBase, attempt, usage: requestUsage });

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

    const maybeScheduleProgressFlush = () => {
        const now = Date.now();
        const shouldFlushBySize = pendingChunk.length + pendingReasoning.length >= UPDATE_BUFFER_CHARS;
        const shouldFlushByTime = now - lastUpdateAt >= UPDATE_INTERVAL_MS;
        if (!pendingChunk && !pendingReasoning) return;
        if (shouldFlushBySize || shouldFlushByTime) {
            void flushPending();
        } else {
            const remaining = UPDATE_INTERVAL_MS - (now - lastUpdateAt);
            scheduleFlush(remaining);
        }
    };

    const flushPending = async () => {
        flushInFlight = flushInFlight.then(async () => {
            if (!pendingChunk && !pendingReasoning) return;
            const chunk = pendingChunk;
            const reasoningChunk = pendingReasoning;
            pendingChunk = '';
            pendingReasoning = '';
            await params.provider.updateJob(params.jobId, {
                contentChunk: chunk || undefined,
                reasoningChunk: reasoningChunk || undefined,
                chunksReceived: chunks,
                leaseOwner: params.context.leaseOwner,
            });
            lastUpdateAt = Date.now();

            if (!params.provider.progressWritesCheckAbort && params.provider.checkJobAborted) {
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
        for await (const evt of parseOpenRouterSSE(params.stream, {
            streamedFieldMode: params.streamedFieldMode,
        })) {
            const measuredEvent = evt.type === 'usage'
                ? { ...evt, requestUsage: attachRequestUsage(usagePrefix, evt.usage, {
                    requestId: usageRequestId, iteration: normalizedState.iteration, measuredAt: Date.now(),
                }) } : evt;
            const normalizedEvent =
                evt.type === 'text' && continuationNormalizer
                    ? { ...evt, text: continuationNormalizer.push(evt.text) }
                    : measuredEvent;
            if (normalizedEvent.type === 'text' && !normalizedEvent.text) continue;
            normalizedState = reduceNormalizedStreamEvent(normalizedState, normalizedEvent);
            if (evt.type === 'usage' && normalizedState.requestUsage) {
                requestUsage = normalizedState.requestUsage;
                // A measured iteration must be durable before abort or a later
                // request can win the race. This is not a text-chunk counter.
                await params.provider.updateJob(params.jobId, {
                    usage: requestUsage, leaseOwner: params.context.leaseOwner,
                });
            }
            if (evt.type === 'text') {
                fullContent = contentBase + normalizedState.cumulativeText;
                chunks = normalizedState.chunks;
                pendingChunk += normalizedEvent.type === 'text' ? normalizedEvent.text : '';
                emitJobDelta(params.jobId, normalizedEvent.type === 'text' ? normalizedEvent.text : '', {
                    attempt,
                    contentLength: fullContent.length,
                    chunksReceived: chunks,
                    reasoningLength: fullReasoning.length,
                });

                maybeScheduleProgressFlush();
                if (flushError) {
                    throw flushError;
                }
            } else if (evt.type === 'reasoning') {
                // Reasoning is progress: it must be flushed and broadcast even
                // when no visible answer text exists.
                fullReasoning = reasoningBase + normalizedState.reasoningText;
                pendingReasoning += evt.text;
                emitJobReasoningDelta(params.jobId, evt.text, {
                    attempt,
                    reasoningLength: fullReasoning.length,
                    chunksReceived: chunks,
                });
                maybeScheduleProgressFlush();
                if (flushError) {
                    throw flushError;
                }
            }
        }

        const continuationTail = continuationNormalizer?.finish() ?? '';
        if (continuationTail) {
            normalizedState = reduceNormalizedStreamEvent(normalizedState, {
                type: 'text',
                text: continuationTail,
            });
            fullContent = contentBase + normalizedState.cumulativeText;
            chunks = normalizedState.chunks;
            pendingChunk += continuationTail;
            emitJobDelta(params.jobId, continuationTail, {
                attempt,
                contentLength: fullContent.length,
                chunksReceived: chunks,
                reasoningLength: fullReasoning.length,
            });
        }

        clearFlushTimer();
        if (pendingChunk || pendingReasoning) {
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

        // Complete the job with a single terminal snapshot so the canonical
        // history worker consumes exactly the accepted content and reasoning.
        const completedAt = Date.now();
        await persistTerminalGenerationSnapshot(
            params.provider,
            params.jobId,
            {
                status: 'complete',
                content: fullContent,
                usage: requestUsage,
                reasoning: fullReasoning,
                completedAt,
            },
            params.context.leaseOwner
        );

        emitJobStatus(params.jobId, 'complete', {
            attempt,
            content: fullContent,
            usage: requestUsage,
            contentLength: fullContent.length,
            reasoning: fullReasoning,
            reasoningLength: fullReasoning.length,
            chunksReceived: chunks,
            completedAt,
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

            } catch (err) {
                logBackgroundEvent(
                    'warn',
                    'background.chat.notification.complete_failed',
                    {
                        jobId: params.jobId,
                        error: err instanceof Error ? err.message : String(err),
                    }
                );

                // Do not fail the job if notification fails
            }
        }

    } catch (err) {
        if (isBackgroundJobLeaseLost(err)) throw err;
        normalizedState = failNormalizedStream(normalizedState, err);
        clearFlushTimer();
        try {
            if (pendingChunk || pendingReasoning) await flushPending();
            await flushInFlight;
        } catch {
            /* terminal handling below remains authoritative */
        }
        if (err instanceof Error && err.name === 'AbortError') {
            const latest = await params.provider
                .getJob(params.jobId, params.context.userId)
                .catch(() => null);
            // A user abort is terminal. A lease-loss abort must bubble so a
            // new worker can resume without publishing a false aborted state.
            if (latest?.status !== 'aborted' && !getChatJobExecution(latest ?? {})?.cancellationRequestedAt) throw err;
            await persistTerminalGenerationSnapshot(params.provider, params.jobId, {
                status: 'aborted', content: fullContent, reasoning: fullReasoning, usage: requestUsage, completedAt: Date.now(),
            }, params.context.leaseOwner);
            emitJobStatus(params.jobId, 'aborted', {
                attempt,
                content: fullContent,
                usage: requestUsage,
                contentLength: fullContent.length,
                reasoning: fullReasoning,
                reasoningLength: fullReasoning.length,
                chunksReceived: chunks,
                completedAt: Date.now(),
            });
            return;
        }

        const failedAt = Date.now();
        const failureMessage = serializeError(classifyDelegationDispatchFailure(err, params.context.execution), { code: 'ERR_STREAM_FAILURE', source: 'provider', credentialSource: params.context.credentialSource ?? params.context.execution?.credentialSource });
        await persistTerminalGenerationSnapshot(
            params.provider,
            params.jobId,
            {
                status: 'error',
                content: fullContent,
                usage: requestUsage,
                reasoning: fullReasoning,
                error: failureMessage,
                completedAt: failedAt,
            },
            params.context.leaseOwner
        );
        emitJobStatus(params.jobId, 'error', {
            attempt,
            content: fullContent,
            usage: requestUsage,
            contentLength: fullContent.length,
            reasoning: fullReasoning,
            reasoningLength: fullReasoning.length,
            chunksReceived: chunks,
            completedAt: failedAt,
            error: failureMessage,
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

        const notifyOnError = shouldNotify();

        if (notifyOnError) {
            // Emit error notification
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    presentError(err, { code: 'ERR_STREAM_FAILURE', source: 'provider', credentialSource: params.context.credentialSource ?? params.context.execution?.credentialSource }).message
                );

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
    provider: DurableBackgroundJobProvider;
    context: BackgroundStreamParams;
    toolRuntime?: Record<string, string>;
    shouldNotify?: () => boolean;
    abortSignal?: AbortSignal;
    streamedFieldMode?: StreamedFieldMode;
    contextPolicy?: ContextRequestPolicy;
}): Promise<void> {
    const historyAdmission = params.context.execution?.history;
    const historyJob = historyAdmission ? await params.provider.getJob(params.jobId, params.context.userId) : null;
    const contentBase = params.context.execution?.contentBase ?? '';
    const reasoningBase = params.context.execution?.reasoningBase ?? '';
    let fullContent = contentBase;
    let fullReasoning = reasoningBase;
    let chunks = 0;
    let normalizedState = params.context.execution?.normalizedToolState
        ? {
              ...params.context.execution.normalizedToolState,
              cumulativeText: '',
              iterationText: '',
              reasoningText: '',
              terminal: 'active' as const,
          }
        : createNormalizedStreamState({
              outputLimitBytes: MAX_CANONICAL_MESSAGE_OUTPUT_BYTES,
          });
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
        runtime?: 'client' | 'server' | 'hybrid';
        text_offset?: number;
    }>();
    // How much of the row's text existed before each call's results; a replay
    // sends later text after them. Kept across state replacements.
    const textOffsets = new Map<string, number>();
    const setToolState = (id: string, state: Parameters<typeof toolStates.set>[1]) => {
        const textOffset = textOffsets.get(id);
        toolStates.set(id, textOffset === undefined ? state : { ...state, text_offset: textOffset });
    };
    const toolLedger = new Map<string, ToolLedgerEntry>();
    let pendingProviderContent = '';
    let pendingProviderReasoning = '';
    let providerDirtyEvents = 0;
    let lastProviderFlushAt = Date.now();
    const persistedJob = await params.provider.getJob(params.jobId, params.context.userId);
    const attempt = params.context.attempt ?? persistedJob?.attempts;
    let requestUsage = readRequestUsage(persistedJob?.usage) ?? readRequestUsage(normalizedState.requestUsage);
    for (const call of persistedJob?.tool_calls ?? []) {
        if (!call.id) continue;
        const fingerprint = call.argument_fingerprint
            ?? (call.args === undefined ? '' : toolCallFingerprint(call.name, call.args));
        if (!fingerprint) continue;
        const state = call.status === 'complete' ? 'completed'
            : call.status === 'error' || call.status === 'skipped' ? 'failed'
            : call.status === 'loading' ? 'running' : 'pending';
        toolStates.set(call.id, { ...call, argument_fingerprint: fingerprint });
        if (typeof call.text_offset === 'number') textOffsets.set(call.id, call.text_offset);
        toolLedger.set(call.id, {
            callId: call.id, name: call.name, argumentFingerprint: fingerprint,
            state, result: call.result, error: call.error,
        });
    }

    const flushProviderProgress = async (force = false) => {
        if (providerDirtyEvents === 0) return;
        if (
            !force &&
            pendingProviderContent.length + pendingProviderReasoning.length < 16 * 1024 &&
            Date.now() - lastProviderFlushAt < 500
        ) return;
        const contentChunk = pendingProviderContent;
        pendingProviderContent = '';
        const reasoningChunk = pendingProviderReasoning;
        pendingProviderReasoning = '';
        providerDirtyEvents = 0;
        await params.provider.updateJob(params.jobId, {
            contentChunk: contentChunk || undefined,
            reasoningChunk: reasoningChunk || undefined,
            chunksReceived: chunks,
            tool_calls: Array.from(toolStates.values()),
            leaseOwner: params.context.leaseOwner,
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

        emitJobStatus(params.jobId, 'streaming', {
            attempt,
            content: fullContent,
            usage: requestUsage,
            contentLength: fullContent.length,
            chunksReceived: chunks,
            tool_calls: publicToolCalls,
        });
    };

    initJobLiveState(params.jobId, { contentBase, reasoningBase, attempt, usage: requestUsage });

    const orMessages = Array.isArray(params.body.messages)
        ? params.body.messages.slice()
        : [];

    const persistToolCheckpoint = async (
        pendingToolCalls: ToolCall[] | undefined,
        clientToolCall?: BackgroundJobExecution['clientToolCall'],
        completeDispatch = false,
    ) => {
        if (
            !params.context.execution ||
            !params.context.leaseOwner
        ) return;
        // The checkpoint must never claim a tool is done before its visible
        // state and streamed text are durable in the job record.
        await flushProviderProgress(true);
        const nextToolChoice = isForcedFunctionToolChoice(activeToolChoice)
            ? 'auto'
            : activeToolChoice;
        const checkpoint: BackgroundJobExecution = {
            ...params.context.execution,
            body: {
                ...params.context.body,
                messages: orMessages,
                tool_choice: nextToolChoice,
            },
            contentBase: fullContent,
            reasoningBase: fullReasoning,
            normalizedToolState: normalizedState,
            checkpointedToolCallIds: Array.from(toolStates.values())
                .filter(
                    (call) =>
                        call.id &&
                        call.status !== 'pending' &&
                        call.status !== 'loading'
                )
                .map((call) => call.id!),
            pendingToolCalls:
                pendingToolCalls && pendingToolCalls.length > 0
                    ? pendingToolCalls
                    : undefined,
            clientToolCall,
            ...(completeDispatch ? { delegationDispatch: undefined } : {}),
        };
        const marker = params.context.execution.delegationDispatch;
        if (completeDispatch && (!marker || !params.provider.commitDelegationDispatch))
            throw new Error('Durable model checkpoint is unavailable.');
        const saved = completeDispatch
            ? await params.provider.commitDelegationDispatch!(params.jobId, params.context.leaseOwner, marker!.sequence,
                checkpoint, Array.from(toolStates.values()))
            : await params.provider.updateJobExecution(params.jobId, checkpoint, params.context.leaseOwner);
        if (!saved) throw createBackgroundJobLeaseLostError();
        params.context.execution = checkpoint;
        params.context.body = checkpoint.body;
        activeToolChoice = nextToolChoice;
    };

    const processToolQueue = async (calls: ToolCall[]): Promise<boolean> => {
        for (let index = 0; index < calls.length; index += 1) {
            const toolCall = calls[index]!;
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
            const blockedDelegation = params.context.execution?.delegationBlocked === true &&
                toolCall.function.name === DELEGATE_CHAT_TOOL && decision.action === 'execute';

            let durableDelegationError: string | undefined;
            if (!blockedDelegation && admittedDefinition && toolCall.function.name === DELEGATE_CHAT_TOOL && decision.action === 'execute' &&
                params.context.execution?.delegationRecoveryPolicy === 'v1') {
                try {
                    const leaseOwner = params.context.leaseOwner;
                    const syncId = persistedJob?.syncProviderId;
                    const configuredSync = (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider;
                    const sync = syncId ? getSyncGatewayAdapter(syncId) : undefined;
                    if (!leaseOwner || !supportsDelegationCoordination(params.provider) || !syncId || syncId !== configuredSync ||
                        !supportsDelegationHistory(sync) || !getShutdownRuntime().controller.canStartWork())
                        throw new DelegationPreparationError('Durable delegation is unavailable for this deployment.');
                    setToolState(toolCall.id, { id: toolCall.id, name: toolCall.function.name, status: 'pending',
                        runtime: 'server', args: toolCall.function.arguments, argument_fingerprint: decision.fingerprint });
                    await emitToolState(true);
                    await persistToolCheckpoint(calls.slice(index));
                    const parent = await params.provider.getJob(params.jobId, params.context.userId);
                    if (!parent || parent.leaseOwner !== leaseOwner || (parent.leaseExpiresAt ?? 0) <= Date.now())
                        throw createBackgroundJobLeaseLostError();
                    const { assertServerProjectExecutionSupported } = await import('../chat/project-policy');
                    const authority = { subject: params.context.userId, workspaceId: params.context.workspaceId,
                        threadId: params.context.threadId, abortSignal: params.abortSignal ?? AbortSignal.timeout(10_000) };
                    await assertServerProjectExecutionSupported(authority, 'workspace.write');
                    const wait = await prepareDelegationWait(parent, { callId: toolCall.id, argumentsJson: toolCall.function.arguments,
                        apiKey: params.apiKey, serverURL: useRuntimeConfig().openrouterBaseUrl, signal: params.abortSignal });
                    await assertServerProjectExecutionSupported(authority, 'workspace.write');
                    await assertJobNotAborted({ provider: params.provider, jobId: params.jobId, abortSignal: params.abortSignal });
                    if (!getShutdownRuntime().controller.canStartWork()) throw new DelegationPreparationError('Durable delegation is unavailable during shutdown.');
                    if ((useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider !== syncId ||
                        getSyncGatewayAdapter(syncId) !== sync)
                        throw new DelegationPreparationError('The delegation sync provider changed during preparation.');
                    const checkpoint = { ...params.context.execution!, delegationWait: wait };
                    let parked: boolean;
                    try {
                        parked = await params.provider.parkDelegationWait!(params.jobId, leaseOwner, checkpoint, Array.from(toolStates.values()));
                    } catch {
                        // The write may have committed despite a lost acknowledgement.
                        // Yield the worker; recovery will inspect the durable checkpoint.
                        pauseJobLiveState(params.jobId, attempt);
                        throw createBackgroundJobLeaseLostError();
                    }
                    if (parked) {
                        params.context.execution = checkpoint;
                        pauseJobLiveState(params.jobId, attempt);
                        return true;
                    }
                    const fresh = await params.provider.getJob(params.jobId, params.context.userId);
                    if (!fresh || fresh.leaseOwner !== leaseOwner || (fresh.leaseExpiresAt ?? 0) <= Date.now())
                        throw createBackgroundJobLeaseLostError();
                    throw new DelegationPreparationError('The delegated chat waiting limit has been reached.');
                } catch (error) {
                    if (params.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError') || isBackgroundJobLeaseLost(error)) throw error;
                    durableDelegationError = error instanceof DelegationPreparationError ? error.message : 'Durable delegation is unavailable.';
                }
            }

            if (
                runtimeHint === 'client' &&
                admittedDefinition &&
                decision.action === 'execute' &&
                !blockedDelegation && !durableDelegationError
            ) {
                setToolState(toolCall.id, {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    status: 'pending',
                    runtime: 'client',
                    args: toolCall.function.arguments,
                    argument_fingerprint: decision.fingerprint,
                });
                await emitToolState(true);
                await persistToolCheckpoint(calls.slice(index), {
                    callId: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                    argumentFingerprint: decision.fingerprint,
                    definition: admittedDefinition,
                });
                return true;
            }

            let toolResultText = '';
            let status: 'complete' | 'error' | 'skipped' = 'complete';
            let errorMessage: string | undefined;
            if (durableDelegationError) {
                status = 'error';
                errorMessage = durableDelegationError;
                toolResultText = errorMessage;
            } else if (blockedDelegation) {
                status = 'error';
                errorMessage = 'A previous delegated chat has an unknown outcome. Start a new user turn to retry.';
                toolResultText = errorMessage;
            } else if (decision.action === 'replay') {
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
                status = 'error';
                errorMessage = `Tool "${toolCall.function.name}" could not be delegated to the browser.`;
                toolResultText = errorMessage;
            } else {
                toolLedger.set(toolCall.id, {
                    callId: toolCall.id,
                    name: toolCall.function.name,
                    argumentFingerprint: decision.fingerprint,
                    state: 'running',
                });
                setToolState(toolCall.id, {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    status: 'loading',
                    runtime: runtimeHint === 'hybrid' ? 'hybrid' : 'server',
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
                        abortSignal:
                            params.abortSignal ?? new AbortController().signal,
                    },
                    { definition: admittedDefinition },
                    toolCall.function.name === 'search_models' ? {
                        modelCatalog: async (signal) => {
                            try {
                                return await fetchOpenRouterCatalog(createOpenRouterClient({
                                    apiKey: params.apiKey, serverURL: useRuntimeConfig().openrouterBaseUrl,
                                }), signal, { deadlineMs: 15_000 });
                            } catch {
                                throw new Error('Model catalog is unavailable.');
                            }
                        },
                    } : undefined
                );
                if (execution.error) {
                    status = execution.runtime === 'client' ? 'skipped' : 'error';
                    errorMessage = execution.error;
                    toolResultText = `Error executing tool "${toolCall.function.name}": ${execution.error}`;
                } else {
                    toolResultText = execution.result || '';
                }
            }

            const projectedResult = projectToolResult(toolResultText);
            if (historyJob) projectedResult.durable = await retainBackgroundToolResult(historyJob, projectedResult.durable, toolCall.id);
            logBackgroundEvent('info', 'background.tools.call.completed', {
                jobId: params.jobId,
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                status,
                argumentMetadata: sensitiveValueMetadata(
                    toolCall.function.arguments
                ),
                resultMetadata:
                    status === 'complete'
                        ? sensitiveValueMetadata(toolResultText)
                        : undefined,
                errorMetadata: errorMessage
                    ? sensitiveValueMetadata(errorMessage)
                    : undefined,
            });
            toolLedger.set(toolCall.id, {
                callId: toolCall.id,
                name: toolCall.function.name,
                argumentFingerprint: decision.fingerprint,
                state: status === 'complete' ? 'completed' : 'failed',
                result: status === 'complete' ? projectedResult.durable : undefined,
                error: status === 'complete' ? undefined : errorMessage,
            });
            setToolState(toolCall.id, {
                id: toolCall.id,
                name: toolCall.function.name,
                status,
                runtime:
                    runtimeHint === 'client' || runtimeHint === 'hybrid'
                        ? runtimeHint
                        : 'server',
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
                    : {
                          status: status === 'skipped' ? 'skipped' : 'error',
                          error: errorMessage,
                      }
            );
            await emitToolState();
            orMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: [{ type: 'text', text: projectedResult.model }],
            });
        }
        normalizedState = finishNormalizedIteration(
            normalizedState,
            MAX_TOOL_ITERATIONS
        ).state;
        await persistToolCheckpoint(undefined, undefined);
        return false;
    };
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
        const resumedQueue = params.context.execution?.pendingToolCalls;
        if (resumedQueue?.length) {
            const parked = await processToolQueue(resumedQueue as ToolCall[]);
            if (parked) return;
            normalizedState = finishNormalizedIteration(
                normalizedState,
                MAX_TOOL_ITERATIONS
            ).state;
        }
        for (;;) {
            // A browser result can resume with no remaining queue. Check the
            // prior tool iteration before opening another paid model request.
            normalizedState = finishNormalizedIteration(
                normalizedState,
                MAX_TOOL_ITERATIONS
            ).state;
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

            const requestBody = JSON.parse(JSON.stringify({
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
            })) as Record<string, unknown>;
            await admitServerProviderBody(requestBody, params.contextPolicy ? { ...params.contextPolicy,
                measuredUsage: normalizedState.requestUsage } : undefined, params.abortSignal);
            const usagePrefix = await captureBackgroundUsagePrefix(requestBody);
            const usageRequestId = crypto.randomUUID();
            const { assertServerProjectExecutionSupported } = await import('../chat/project-policy');

            const { response: upstream, errorText: refusedText } = await sendWithAffordableReply(async (body) => {
                await assertServerProjectExecutionSupported({ subject: params.context.userId,
                    workspaceId: params.context.workspaceId, threadId: params.context.threadId,
                    abortSignal: params.abortSignal ?? AbortSignal.timeout(10_000) }, 'workspace.write');
                await assertJobNotAborted({ provider: params.provider, jobId: params.jobId, abortSignal: params.abortSignal });
                await beginDelegationDispatch(params.jobId, params.context, params.provider);
                return fetchWithResponseDeadline(openRouterUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${params.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'HTTP-Referer': params.referer,
                    'X-Title': 'or3.chat',
                },
                body: JSON.stringify(body),
            }, { signal: params.abortSignal });
            }, requestBody, {
                defaultAllowance: params.context.execution?.delegationRecoveryPolicy !== 'v1' &&
                    !!params.contextPolicy && params.contextPolicy.requestedCompletionTokens == null,
                signal: params.abortSignal,
            });

            if (!upstream.ok || !upstream.body) {
                const errorText = refusedText ?? await readResponseTextWithIdleDeadline(upstream, {
                    signal: params.abortSignal,
                }).catch(() => '<no body>');
                logBackgroundEvent('warn', 'background.tools.upstream_rejected', {
                    jobId: params.jobId,
                    iteration: loopIteration,
                    status: upstream.status,
                    responseMetadata: sensitiveValueMetadata(errorText),
                });
                const metadata = { ...normalizeProviderResponseError(errorText, upstream.status,
                    { credentialSource: params.context.credentialSource ?? params.context.execution?.credentialSource }),
                    retryAfterMs: parseRetryAfter(upstream.headers.get('retry-after')) };
                throw Object.assign(new OpenRouterStreamError(presentError(metadata).message, { ...metadata, status: upstream.status }),
                    { confirmedModelRejection: !upstream.ok });
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
                const measuredEvent = evt.type === 'usage'
                    ? { ...evt, requestUsage: attachRequestUsage(usagePrefix, evt.usage, {
                        requestId: usageRequestId, iteration: loopIteration, measuredAt: Date.now(),
                    }) } : evt;
                normalizedState = reduceNormalizedStreamEvent(normalizedState, measuredEvent);
                if (evt.type === 'usage' && normalizedState.requestUsage) {
                    requestUsage = normalizedState.requestUsage;
                    await params.provider.updateJob(params.jobId, {
                        usage: requestUsage, leaseOwner: params.context.leaseOwner,
                    });
                }
                if (evt.type === 'text') {
                    fullContent = contentBase + normalizedState.cumulativeText;
                    loopContent = normalizedState.iterationText;
                    chunks = normalizedState.chunks;
                    pendingProviderContent += evt.text;
                    providerDirtyEvents += 1;
                    emitJobDelta(params.jobId, evt.text, {
                        attempt,
                        contentLength: fullContent.length,
                        chunksReceived: chunks,
                        reasoningLength: fullReasoning.length,
                    });
                    await flushProviderProgress();
                }
                if (evt.type === 'reasoning') {
                    // Reasoning-only progress must persist and broadcast even
                    // when no answer text exists for this iteration.
                    fullReasoning =
                        reasoningBase + normalizedState.reasoningText;
                    pendingProviderReasoning += evt.text;
                    providerDirtyEvents += 1;
                    emitJobReasoningDelta(params.jobId, evt.text, {
                        attempt,
                        reasoningLength: fullReasoning.length,
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
                        setToolState(toolCall.id, {
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
            for (const toolCall of pendingToolCalls) {
                textOffsets.set(toolCall.id, fullContent.length);
                const state = toolStates.get(toolCall.id);
                if (state) setToolState(toolCall.id, state);
            }
            if (params.context.execution?.delegationRecoveryPolicy === 'v1')
                await persistToolCheckpoint(pendingToolCalls, undefined, true);
            const parked = await processToolQueue(pendingToolCalls);
            if (parked) return;
            await flushProviderProgress(true);

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
        const toolCompletedAt = Date.now();
        await persistTerminalGenerationSnapshot(
            params.provider,
            params.jobId,
            {
                status: 'complete',
                content: fullContent,
                usage: requestUsage,
                reasoning: fullReasoning,
                toolCalls: Array.from(toolStates.values()),
                completedAt: toolCompletedAt,
            },
            params.context.leaseOwner
        );
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
            attempt,
            content: fullContent,
            usage: requestUsage,
            contentLength: fullContent.length,
            reasoning: fullReasoning,
            reasoningLength: fullReasoning.length,
            chunksReceived: chunks,
            completedAt: toolCompletedAt,
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

        if (notifyOnComplete) {
            try {
                await notificationEmitter?.emitBackgroundJobComplete(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    params.context.messageId
                );

            } catch (err) {
                logBackgroundEvent(
                    'warn',
                    'background.tools.notification.complete_failed',
                    {
                        jobId: params.jobId,
                        error: err instanceof Error ? err.message : String(err),
                    }
                );

            }
        }
    } catch (err) {
        if (isBackgroundJobLeaseLost(err)) throw err;
        normalizedState = failNormalizedStream(normalizedState, err);
        // Preserve the last coalesced text/tool snapshot before publishing a
        // terminal error. A failed flush must not hide the original failure.
        try {
            await flushProviderProgress(true);
        } catch {
            /* terminal handling below remains authoritative */
        }
        if (err instanceof Error && err.name === 'AbortError') {
            const latest = await params.provider
                .getJob(params.jobId, params.context.userId)
                .catch(() => null);
            if (latest?.status !== 'aborted' && !getChatJobExecution(latest ?? {})?.cancellationRequestedAt) throw err;
            await persistTerminalGenerationSnapshot(params.provider, params.jobId, {
                status: 'aborted', content: fullContent, reasoning: fullReasoning, usage: requestUsage,
                toolCalls: Array.from(toolStates.values()), completedAt: Date.now(),
            }, params.context.leaseOwner);
            emitJobStatus(params.jobId, 'aborted', {
                attempt,
                content: fullContent,
                usage: requestUsage,
                contentLength: fullContent.length,
                reasoning: fullReasoning,
                reasoningLength: fullReasoning.length,
                chunksReceived: chunks,
                completedAt: Date.now(),
                tool_calls: Array.from(toolStates.values()),
            });
            return;
        }

        const toolFailedAt = Date.now();
        const toolFailureMessage = serializeError(classifyDelegationDispatchFailure(err, params.context.execution), { code: 'ERR_STREAM_FAILURE', source: 'provider', credentialSource: params.context.credentialSource ?? params.context.execution?.credentialSource });
        await persistTerminalGenerationSnapshot(
            params.provider,
            params.jobId,
            {
                status: 'error',
                content: fullContent,
                usage: requestUsage,
                reasoning: fullReasoning,
                toolCalls: Array.from(toolStates.values()),
                error: toolFailureMessage,
                completedAt: toolFailedAt,
            },
            params.context.leaseOwner
        );
        emitJobStatus(params.jobId, 'error', {
            attempt,
            content: fullContent,
            usage: requestUsage,
            contentLength: fullContent.length,
            reasoning: fullReasoning,
            reasoningLength: fullReasoning.length,
            chunksReceived: chunks,
            completedAt: toolFailedAt,
            error: toolFailureMessage,
            tool_calls: Array.from(toolStates.values()),
        });
        await emitBackgroundJobWebhookEvent({
            status: 'failed',
            jobId: params.jobId,
            workspaceId: params.context.workspaceId,
            userId: params.context.userId,
            threadId: params.context.threadId,
            messageId: params.context.messageId,
            error: toolFailureMessage,
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

        if (notifyOnError) {
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.context.workspaceId,
                    params.context.userId,
                    params.context.threadId,
                    params.jobId,
                    err instanceof Error ? err.message : String(err)
                );

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

            }
        }

        throw err;
    }
}

/**
 * Stream in the background without keeping a client connection open.
 */
export async function executeBackgroundJob(
    jobId: string,
    params: BackgroundStreamParams,
    provider: DurableBackgroundJobProvider,
    abortSignal?: AbortSignal
): Promise<void> {
    // Capture before the first asynchronous boundary: provenance and bytes sent
    // must not observe later caller/tool-loop mutations of an admitted payload.
    const admittedBody = JSON.parse(JSON.stringify(params.body)) as Record<string, unknown>;
    const admittedJob = await provider.getJob(jobId, params.userId);
    if (params.leaseOwner && admittedJob?.leaseOwner !== params.leaseOwner) {
        throw createBackgroundJobLeaseLostError();
    }
    params = { ...params, body: admittedBody, attempt: params.attempt ?? admittedJob?.attempts };
    const signal =
        abortSignal ??
        provider.getAbortController?.(jobId)?.signal ??
        new AbortController().signal;

    // Strip internal fields from body before sending to OpenRouter
    const {
        _background,
        _threadId,
        _messageId,
        _backgroundAdmissionId,
        _backgroundMode,
        _toolRuntime,
        _clientDeviceId,
        _streamedFieldMode,
        _history,
        _context,
        _delegationDefaults,
        _durableDelegation,
        ...cleanBody
    } = admittedBody;
    const toolRuntime =
        typeof _toolRuntime === 'object' && _toolRuntime !== null
            ? (_toolRuntime as Record<string, string>)
            : undefined;
    const streamedFieldMode = normalizeStreamedFieldMode(_streamedFieldMode);

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
            abortSignal: signal,
            streamedFieldMode,
            contextPolicy: await resolveServerContextPolicy(admittedBody, params.apiKey, useRuntimeConfig().openrouterBaseUrl, signal),
        });
        return;
    }

    const openRouterUrl = resolveOpenRouterChatCompletionsUrl();
    const contextPolicy = await resolveServerContextPolicy(admittedBody, params.apiKey, useRuntimeConfig().openrouterBaseUrl, signal);
    await admitServerProviderBody(cleanBody, contextPolicy, signal);
    const usagePrefix = await captureBackgroundUsagePrefix(cleanBody);
    const { assertServerProjectExecutionSupported } = await import('../chat/project-policy');
    const { response: upstream, errorText: refusedText } = await sendWithAffordableReply(async (body) => {
        await assertServerProjectExecutionSupported({ subject: params.userId, workspaceId: params.workspaceId,
            threadId: params.threadId, abortSignal: signal }, 'workspace.write');
        await assertJobNotAborted({ provider, jobId, abortSignal: signal });
        await beginDelegationDispatch(jobId, params, provider);
        return fetchWithResponseDeadline(openRouterUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'HTTP-Referer': params.referer,
            'X-Title': 'or3.chat',
        },
        body: JSON.stringify(body),
    }, { signal });
    }, cleanBody, {
        defaultAllowance: params.execution?.delegationRecoveryPolicy !== 'v1' &&
            !!contextPolicy && contextPolicy.requestedCompletionTokens == null,
        signal,
    });

    if (!upstream.ok || !upstream.body) {
        const errorText = refusedText ?? await readResponseTextWithIdleDeadline(upstream, {
            signal,
        }).catch(() => '<no body>');

        const metadata = { ...normalizeProviderResponseError(errorText, upstream.status,
            { credentialSource: params.credentialSource ?? params.execution?.credentialSource }),
            retryAfterMs: parseRetryAfter(upstream.headers.get('retry-after')) };
        throw Object.assign(new OpenRouterStreamError(presentError(metadata).message, { ...metadata, status: upstream.status }),
            { confirmedModelRejection: !upstream.ok });
    }

    await consumeBackgroundStream({
        jobId,
        stream: withIdleWatchdog(upstream.body, { signal }),
        context: params,
        provider,
        shouldNotify: () => !hasJobViewers(jobId),
        streamedFieldMode,
        usagePrefix,
    });
}

/**
 * Purpose:
 * Expose background streaming availability for route handlers.
 */
export function isBackgroundStreamingAvailable(): boolean {
    return isBackgroundStreamingEnabled();
}
