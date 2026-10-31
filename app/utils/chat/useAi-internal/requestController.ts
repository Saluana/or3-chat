import { shallowRef, type ShallowRef, type Ref } from 'vue';
import type { Or3DB } from '~/db/client';
import type { Message } from '~/db';
import { getWriteTxTableNames } from '~/db/util';
import type {
    ChatRequestState,
    ChatMessage,
    SendResult,
    SendFailureReason,
} from '~/utils/chat/types';
import { ensureUiMessage, type UiChatMessage, type ToolCallInfo } from '~/utils/chat/uiMessages';
import { deriveMessageContent } from '~/utils/chat/messages';
import { associateUiToolResultMessages } from '~/utils/chat/transcript';
import type { ToolLedgerEntry } from '~~/shared/chat/tool-ledger';
import type { AssistantPersister, StoredMessage } from './types';
import { updateMessageRecord } from './persistence';
import { projectCanonicalBackgroundMessage } from './backgroundJobPersistence';
import { isStaleForegroundGeneration } from '~/utils/chat/generation-lease';
import { tryGetHooks } from '~/core/hooks/useHooks';
import { serializeError } from '~~/shared/errors';
import { parseHashes } from '~/utils/files/attachments';

/**
 * The classified public error of a failed foreground turn, kept beside the
 * `stream_interrupted` sentinel so the inline text still matches the toast
 * after a reload. `serializeError` carries metadata only, never upstream text.
 * Tracker/canonical persistence owns its own `error` string and is excluded.
 */
function terminalErrorEnvelope(terminal: RequestTerminal): string | null {
    return terminal.outcome === 'failed' &&
        terminal.error &&
        terminal.persistence !== 'tracker' &&
        terminal.persistence !== 'canonical'
        ? serializeError(terminal.error)
        : null;
}

type Accumulator = {
    reset: () => void;
    append: (text: string, options: { kind: 'text' | 'reasoning' }) => void;
    state: { finalized: boolean };
    finalize: (options?: { error?: Error; aborted?: boolean }) => void;
};

export type RequestTerminal = {
    outcome: 'completed' | 'failed' | 'aborted';
    content?: string;
    reasoning?: string | null;
    toolCalls?: ToolCallInfo[] | null;
    error?: Error;
    failureReason?: SendFailureReason;
    messageError?: string | null;
    generationState?:
        | 'complete'
        | 'failed'
        | 'error'
        | 'aborted'
        | 'interrupted';
    /** Ordinary failed/aborted sends remove a genuinely empty placeholder. */
    deleteEmpty?: boolean;
    /** The existing tracker owns background persistence and its retry queue. */
    persistence?: 'request' | 'tracker' | 'canonical';
    /** Re-read already-finalized local canonical history before projecting UI. */
    canonicalFinalized?: boolean;
    attempt?: number;
    /** Completion hooks/history writeback run after a successful durable write. */
    afterPersist?: () => Promise<void>;
    beforePersist?: () => Promise<void>;
};

export type RequestFinalization = {
    terminal: RequestTerminal;
    deleted: boolean;
    superseded: boolean;
    persistenceError?: unknown;
    effectError?: unknown;
    canonicalRow?: StoredMessage;
    canonicalUnavailable?: boolean;
};

/** One owner per admitted generation; attachment and save state are independent. */
export type ChatRequest = {
    expectedProjectId?: string | null;
    readonly requestId: string;
    readonly originDb: Or3DB;
    readonly workspaceId: string;
    /** Account captured before asynchronous admission. */
    readonly originUserId?: string;
    readonly accumulator: Accumulator;
    readonly kind: 'send' | 'continue' | 'reattach' | 'recovery';
    projectContext?: import('~/utils/projects/context').ProjectContextSnapshot | null;
    threadId?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    assistantRecord?: StoredMessage;
    message?: UiChatMessage | null;
    backgroundAdmissionId?: string;
    jobId?: string;
    lastAttempt?: number;
    streamId?: string;
    workflowMessageId?: string;
    cancelled: boolean;
    abortController: AbortController | null;
    toolLedger: Map<string, ToolLedgerEntry>;
    persistAssistant?: AssistantPersister;
    readonly phase: ShallowRef<
        'admitted' | 'persisted' | 'streaming' | 'finalizing' | 'terminal'
    >;
    readonly attached: ShallowRef<boolean>;
    readonly persistence: ShallowRef<
        'pending' | 'saved' | 'failed' | 'tracker' | 'superseded'
    >;
    readonly publicState: ShallowRef<ChatRequestState>;
    readonly settled: Promise<void>;
    resolveSettled: () => void;
    ownsView: () => boolean;
    projectTerminal: (result: RequestFinalization) => void;
    finalization?: Promise<RequestFinalization>;
    stopConfirmation?: Promise<boolean>;
    terminal?: RequestTerminal;
    /** Captured UI service; called even after the original view detaches. */
    onFinalizationResult?: (result: RequestFinalization) => void;
};

export function createChatRequest(options: {
    requestId: string;
    originDb: Or3DB;
    workspaceId: string;
    originUserId?: string;
    projectContext?: import('~/utils/projects/context').ProjectContextSnapshot | null;
    threadId?: string;
    accumulator: Accumulator;
    kind?: ChatRequest['kind'];
}): ChatRequest {
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
    });
    return {
        ...options,
        kind: options.kind ?? 'send',
        cancelled: false,
        abortController: null,
        toolLedger: new Map(),
        phase: shallowRef('admitted'),
        attached: shallowRef(true),
        persistence: shallowRef('pending'),
        publicState: shallowRef({
            status: 'admitted',
            requestId: options.requestId,
        }),
        settled,
        resolveSettled,
        ownsView: () => false,
        projectTerminal: () => {},
    };
}

export function cancelRequest(request: ChatRequest): void {
    request.cancelled = true;
    request.abortController?.abort();
}

export function publishRequest(
    request: ChatRequest,
    state: ChatRequestState
): void {
    request.publicState.value = state;
    if (state.status !== 'idle') request.phase.value = state.status;
}

export function settleRequest(request: ChatRequest, result: SendResult): void {
    request.publicState.value = {
        status: 'terminal',
        requestId: request.requestId,
        result,
    };
    // Detached workflows/jobs still own a live generation after the send returns.
    if (result.status === 'detached') request.attached.value = false;
    else request.phase.value = 'terminal';
    request.resolveSettled();
}

/** Update the distinct UI/model-history representations from one terminal snapshot. */
export function projectTerminalMessages(
    request: ChatRequest,
    result: RequestFinalization,
    view: {
        messages: Ref<UiChatMessage[]>;
        rawMessages: Ref<ChatMessage[]>;
        tailAssistant: Ref<UiChatMessage | null>;
    }
): void {
    const id = request.assistantMessageId;
    if (!id || !request.ownsView() || result.superseded) return;
    const terminal = result.terminal;
    if (result.deleted) {
        view.messages.value = view.messages.value.filter(
            (message) => message.id !== id
        );
        view.rawMessages.value = view.rawMessages.value.filter(
            (message) => message.id !== id
        );
        if (view.tailAssistant.value?.id === id)
            view.tailAssistant.value = null;
        return;
    }
    if (result.canonicalUnavailable) return;
    const target =
        view.tailAssistant.value?.id === id
            ? view.tailAssistant.value
            : (view.messages.value.find((message) => message.id === id) ??
              request.message);
    if (!target) return;
    if (result.canonicalRow) {
        const row = result.canonicalRow;
        const rawIndex = view.rawMessages.value.findIndex(
            (message) => message.id === id
        );
        const raw: ChatMessage = {
            id: row.id,
            role: 'assistant',
            content: deriveMessageContent(row),
            data: row.data ?? null,
            reasoning_text:
                typeof row.data?.reasoning_text === 'string'
                    ? row.data.reasoning_text
                    : null,
            pending: row.pending,
            error: row.error,
            stream_id: row.stream_id ?? undefined,
            file_hashes: row.file_hashes ?? undefined,
            index: row.index,
            order_key: row.order_key ?? null,
            created_at: row.created_at,
        };
        if (rawIndex >= 0) {
            view.rawMessages.value[rawIndex] = raw;
            view.rawMessages.value = [...view.rawMessages.value];
        }
        const canonicalUi = associateUiToolResultMessages(
            [ensureUiMessage(raw)],
            rawIndex >= 0
                ? view.rawMessages.value
                : [...view.rawMessages.value, raw]
        )[0]!;
        request.message = canonicalUi;
        if (view.tailAssistant.value?.id === id)
            view.tailAssistant.value = canonicalUi;
        view.messages.value = view.messages.value.map((message) =>
            message.id === id ? canonicalUi : message
        );
        return;
    }
    target.text = terminal.content ?? target.text;
    target.reasoning_text = terminal.reasoning ?? undefined;
    if (terminal.toolCalls !== undefined)
        target.toolCalls = terminal.toolCalls ?? undefined;
    target.pending = false;
    target.error =
        terminal.messageError ??
        (result.persistenceError ? 'stream_interrupted' : null);
    const envelope = terminalErrorEnvelope(terminal);
    target.errorEnvelope = envelope;
    const raw = view.rawMessages.value.find((message) => message.id === id);
    if (raw) {
        raw.content = target.text;
        raw.reasoning_text = terminal.reasoning ?? null;
        raw.error = target.error;
        raw.pending = false;
        if (envelope || raw.data?.error_envelope)
            raw.data = { ...raw.data, error_envelope: envelope };
    }
    if (
        terminal.outcome === 'aborted' &&
        !view.messages.value.some((message) => message.id === id)
    )
        view.messages.value.push(target);
    view.messages.value = [...view.messages.value];
}

type TerminalRecovery = {
    execute: () => Promise<RequestFinalization>;
    retries: number;
    timer?: ReturnType<typeof setTimeout>;
    inFlight?: Promise<RequestFinalization>;
};
const terminalRecoveries = new Map<ChatRequest, TerminalRecovery>();
let terminalLifecycleBound = false;
function guardTerminalSaveUnload(event: BeforeUnloadEvent): void {
    if (!terminalRecoveries.size) return;
    event.preventDefault(); event.returnValue = '';
}
function updateTerminalRecoveryLifecycle(): void {
    if (typeof window === 'undefined') return;
    if (terminalRecoveries.size && !terminalLifecycleBound) {
        window.addEventListener('beforeunload', guardTerminalSaveUnload);
        window.addEventListener('pagehide', retryTerminalSavesWhenHidden);
        window.addEventListener('online', retryTerminalSavesWhenHidden);
        terminalLifecycleBound = true;
    } else if (!terminalRecoveries.size && terminalLifecycleBound) {
        window.removeEventListener('beforeunload', guardTerminalSaveUnload);
        window.removeEventListener('pagehide', retryTerminalSavesWhenHidden);
        window.removeEventListener('online', retryTerminalSavesWhenHidden);
        terminalLifecycleBound = false;
    }
}
function retryTerminalSavesWhenHidden(): void {
    for (const request of terminalRecoveries.keys()) void retryRequestFinalization(request);
}
function settleTerminalRecovery(request: ChatRequest, result: RequestFinalization, execute: () => Promise<RequestFinalization>): void {
    const existing = terminalRecoveries.get(request);
    if (!result.persistenceError || result.superseded || result.terminal.persistence === 'tracker' || result.terminal.persistence === 'canonical') {
        if (existing?.timer) clearTimeout(existing.timer);
        terminalRecoveries.delete(request);
    } else {
        const recovery = existing ?? { execute, retries: 0 };
        terminalRecoveries.set(request, recovery);
        // Five automatic local-only attempts. The snapshot and manual retry remain after exhaustion.
        if (!recovery.timer && recovery.retries < 5) {
            const delay = 1_000 * 2 ** recovery.retries++;
            recovery.timer = setTimeout(() => {
                recovery.timer = undefined;
                void retryTerminalRecovery(request, false);
            }, delay);
        }
    }
    updateTerminalRecoveryLifecycle();
    try { request.onFinalizationResult?.(result); } catch { /* UI notification cannot change the durable result. */ }
}
function retryTerminalRecovery(request: ChatRequest, manual: boolean): Promise<RequestFinalization | undefined> {
    const recovery = terminalRecoveries.get(request);
    if (!recovery) return request.finalization ?? Promise.resolve(undefined);
    if (recovery.inFlight) return recovery.inFlight;
    if (recovery.timer) clearTimeout(recovery.timer);
    recovery.timer = undefined;
    if (manual) recovery.retries = 0;
    recovery.inFlight = Promise.resolve().then(recovery.execute).finally(() => { recovery.inFlight = undefined; });
    request.finalization = recovery.inFlight;
    return recovery.inFlight;
}
/** Retry retained terminal persistence only; never re-enter provider/tool execution. */
export function retryRequestFinalization(request: ChatRequest): Promise<RequestFinalization | undefined> {
    return retryTerminalRecovery(request, true);
}

/**
 * Claim the terminal snapshot synchronously, before any write or hook awaits.
 * Duplicate callbacks share the same promise; stale attempts cannot claim it.
 * A failed save is recorded independently of the generation outcome.
 */
export function finalizeRequest(
    request: ChatRequest,
    input: RequestTerminal
): Promise<RequestFinalization> {
    if (
        typeof input.attempt === 'number' &&
        typeof request.lastAttempt === 'number' &&
        input.attempt < request.lastAttempt
    ) {
        return Promise.resolve({
            terminal: input,
            deleted: false,
            superseded: true,
        });
    }
    if (request.finalization) return request.finalization;
    if (input.outcome === 'completed' && input.persistence !== 'tracker' && input.persistence !== 'canonical'
        && (request.cancelled || request.abortController?.signal.aborted)) {
        return Promise.reject(new DOMException('Chat request cancelled', 'AbortError'));
    }
    if (typeof input.attempt === 'number') request.lastAttempt = input.attempt;
    const terminal: RequestTerminal = {
        ...input,
        content: input.content ?? request.message?.text ?? '',
        reasoning:
            input.reasoning === undefined
                ? (request.message?.reasoning_text ?? null)
                : input.reasoning,
        toolCalls:
            input.toolCalls === undefined
                ? (request.message?.toolCalls ?? null)
                : input.toolCalls,
    };
    // Tool arrays can still be mutated by a detached stream callback. Keep the claimed snapshot immutable.
    if (terminal.toolCalls) terminal.toolCalls = JSON.parse(JSON.stringify(terminal.toolCalls)) as ToolCallInfo[];
    request.terminal = terminal;
    request.phase.value = 'finalizing';
    // Scheduling the body also ensures finalization is assigned before a
    // projection or hook can synchronously deliver another terminal callback.
    const execute = async (firstAttempt: boolean): Promise<RequestFinalization> => {
        const result: RequestFinalization = {
            terminal,
            deleted: false,
            superseded: false,
        };
        try {
            if (firstAttempt) await terminal.beforePersist?.();
        } catch (error) {
            result.effectError = error;
        }
        try {
            if (terminal.persistence === 'tracker') {
                request.persistence.value = 'tracker';
                if (terminal.canonicalFinalized && request.assistantMessageId) {
                    let row: StoredMessage | undefined;
                    let readSucceeded = false;
                    // The server outcome is already terminal. Retry only the
                    // local read, and stop promptly if this view no longer owns it.
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            row = (await request.originDb.messages.get(
                                request.assistantMessageId
                            )) as StoredMessage | undefined;
                            readSucceeded = true;
                            break;
                        } catch {
                            if (attempt === 2 || !request.ownsView()) break;
                            await new Promise<void>((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
                            if (!request.ownsView()) break;
                        }
                    }
                    if (readSucceeded) {
                        const data = row?.data;
                        if (
                            !row || row.deleted || row.role !== 'assistant' ||
                            row.thread_id !== request.threadId || row.pending !== false ||
                            data?.generation_state === 'superseded' ||
                            typeof data?.superseded_by === 'string' ||
                            (request.streamId && data?.generation_id !== request.streamId) ||
                            (typeof data?.background_job_id === 'string' &&
                                data.background_job_id !== request.jobId)
                        ) {
                            result.superseded = true;
                            request.persistence.value = 'superseded';
                        } else {
                            result.canonicalRow = row;
                        }
                    } else {
                        // Keep the job outcome separate from local read failure.
                        // History observation can still restore it later.
                        result.canonicalUnavailable = true;
                    }
                }
            } else if (
                terminal.persistence === 'canonical' &&
                request.assistantMessageId
            ) {
                const projected = await projectCanonicalBackgroundMessage(
                    request.originDb,
                    request.assistantMessageId,
                    {
                        pending: false,
                        error: terminal.messageError ?? null,
                        data: {
                            background_job_status: 'aborted',
                            generation_state: 'aborted',
                            error: terminal.messageError ?? null,
                        },
                    },
                    { generationId: request.streamId, jobId: request.jobId }
                );
                result.superseded = projected === false;
                request.persistence.value = result.superseded
                    ? 'superseded'
                    : 'saved';
            } else if (request.assistantMessageId) {
                const ifCurrent = (latest: Message | undefined) => {
                    const data =
                        latest?.data && typeof latest.data === 'object'
                            ? (latest.data as Record<string, unknown>)
                            : undefined;
                    const generation = data?.generation_id;
                    if (
                        !latest || latest.deleted ||
                        data?.generation_state === 'superseded' ||
                        typeof data?.superseded_by === 'string' ||
                        (typeof data?.background_job_id === 'string' && data.background_job_id !== request.jobId) ||
                        (request.streamId &&
                            typeof generation === 'string' &&
                            generation !== request.streamId) ||
                        (request.kind === 'recovery' &&
                            !isStaleForegroundGeneration({
                                role: latest.role,
                                pending: latest.pending,
                                data,
                            }))
                    ) {
                        result.superseded = true;
                        request.persistence.value = 'superseded';
                        return false;
                    }
                    return true;
                };
                // Reopen only the captured physical database; never redirect to the active workspace.
                if (typeof request.originDb.isOpen === 'function' && !request.originDb.isOpen()) await request.originDb.open();
                const latest = (await request.originDb.messages.get(
                    request.assistantMessageId
                )) as StoredMessage | undefined;
                if (ifCurrent(latest)) {
                    const hasOutput = Boolean(
                        terminal.content ||
                        terminal.reasoning ||
                        terminal.toolCalls?.length ||
                        parseHashes(request.message?.file_hashes).length
                    );
                    if (terminal.deleteEmpty && !hasOutput) {
                        await request.originDb.transaction(
                            'rw',
                            getWriteTxTableNames(request.originDb, 'messages', {
                                includeTombstones: true,
                            }),
                            async () => {
                                const current =
                                    await request.originDb.messages.get(
                                        request.assistantMessageId!
                                    );
                                if (!ifCurrent(current)) return;
                                await request.originDb.messages.delete(
                                    request.assistantMessageId!
                                );
                                result.deleted = true;
                            }
                        );
                    } else {
                        const generationState =
                            terminal.generationState ??
                            (terminal.outcome === 'completed'
                                ? 'complete'
                                : terminal.outcome === 'aborted'
                                  ? 'aborted'
                                  : 'failed');
                        await request.persistAssistant?.({
                            content: terminal.content,
                            reasoning: terminal.reasoning,
                            toolCalls: terminal.toolCalls,
                            finalize: true,
                            terminalState:
                                terminal.outcome === 'completed'
                                    ? 'complete'
                                    : terminal.outcome,
                            ifCurrent,
                        });
                        // Written only on failure, or to clear a stale envelope
                        // once a retry/continue ends differently.
                        const envelope = terminalErrorEnvelope(terminal);
                        const staleEnvelope =
                            typeof (latest?.data as Record<string, unknown> | null | undefined)?.error_envelope === 'string';
                        // These helpers prepare hooks outside their own write
                        // transactions, then check ownership on the fresh row.
                        if (!result.superseded)
                            await updateMessageRecord(
                                request.originDb,
                                request.assistantMessageId!,
                                {
                                    pending: false,
                                    error: terminal.messageError ?? null,
                                    data: {
                                        content: terminal.content,
                                        reasoning_text: terminal.reasoning,
                                        tool_calls: terminal.toolCalls,
                                        generation_state: generationState,
                                        error: terminal.messageError ?? null,
                                        ...(envelope || staleEnvelope
                                            ? { error_envelope: envelope }
                                            : {}),
                                        ...(request.backgroundAdmissionId
                                            ? {
                                                  background_job_status:
                                                      terminal.outcome ===
                                                      'completed'
                                                          ? 'complete'
                                                          : terminal.outcome ===
                                                              'aborted'
                                                            ? 'aborted'
                                                            : 'error',
                                                  background_job_error:
                                                      terminal.error?.message ??
                                                      null,
                                              }
                                            : {}),
                                    },
                                },
                                latest as StoredMessage,
                                ifCurrent
                            );
                    }
                    if (!result.superseded) request.persistence.value = 'saved';
                }
            } else {
                request.persistence.value = 'saved';
            }
        } catch (error) {
            result.persistenceError = error;
            request.persistence.value = 'failed';
        }
        try {
            if (request.ownsView() && !result.superseded)
                request.projectTerminal(result);
            if (!result.persistenceError && !result.superseded) {
                // Foreground completion is emitted by useAi's afterPersist callback.
                // Canonical/tracker responses emit it only for project chats (memory
                // capture); backgroundJobNotifications owns ordinary completions.
                if (
                    terminal.outcome === 'completed' &&
                    request.assistantMessageId &&
                    (request.projectContext || request.expectedProjectId) &&
                    (terminal.persistence === 'tracker' ||
                        terminal.persistence === 'canonical')
                )
                    await tryGetHooks()?.doAction('ai.chat.stream:action:complete', {
                        threadId: request.threadId,
                        workspaceId: request.workspaceId,
                        projectId:
                            request.projectContext?.projectId ??
                            request.expectedProjectId ??
                            null,
                        assistantId: request.assistantMessageId,
                        streamId: request.streamId ?? request.requestId,
                        totalLength: terminal.content?.length ?? 0,
                    });
                await terminal.afterPersist?.();
            }
        } catch (error) {
            result.effectError = error;
        } finally {
            if (request.ownsView() && !request.accumulator.state.finalized) {
                try {
                    request.accumulator.finalize(
                        terminal.outcome === 'aborted'
                            ? { aborted: true }
                            : terminal.outcome === 'failed' ||
                                result.persistenceError
                              ? {
                                    error:
                                        terminal.error ??
                                        new Error(
                                            String(
                                                result.persistenceError ??
                                                    terminal.messageError ??
                                                    'Chat request failed'
                                            )
                                        ),
                                }
                              : undefined
                    );
                } catch (error) {
                    result.effectError ??= error;
                }
            }
            request.phase.value = 'terminal';
            const identity = {
                requestId: request.requestId,
                userMessageId: request.userMessageId,
                assistantMessageId: request.assistantMessageId,
            };
            const outcome: SendResult =
                terminal.outcome === 'aborted'
                    ? { ...identity, status: 'aborted', reason: 'aborted' }
                    : terminal.outcome === 'failed' || result.persistenceError
                      ? {
                            ...identity,
                            status: 'failed',
                            reason: terminal.failureReason ?? 'stream_error',
                            error:
                                terminal.error?.message ??
                                String(
                                    result.persistenceError ??
                                        terminal.messageError ??
                                        'Chat request failed'
                                ),
                        }
                      : identity.userMessageId && identity.assistantMessageId
                        ? {
                              ...identity,
                              userMessageId: identity.userMessageId,
                              assistantMessageId: identity.assistantMessageId,
                              status: 'complete',
                          }
                        : { ...identity, status: 'accepted' };
            request.publicState.value = {
                status: 'terminal',
                requestId: request.requestId,
                result: outcome,
            };
        }
        settleTerminalRecovery(request, result, () => execute(false));
        return result;
    };
    request.finalization = Promise.resolve().then(() => execute(true));
    return request.finalization;
}
