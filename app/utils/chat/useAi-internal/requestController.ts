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
import type { UiChatMessage, ToolCallInfo } from '~/utils/chat/uiMessages';
import type { ToolLedgerEntry } from '~~/shared/chat/tool-ledger';
import type { AssistantPersister, StoredMessage } from './types';
import { updateMessageRecord } from './persistence';
import { projectCanonicalBackgroundMessage } from './backgroundJobPersistence';
import { isStaleForegroundGeneration } from '~/utils/chat/generation-lease';

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
};

/** One owner per admitted generation; attachment and save state are independent. */
export type ChatRequest = {
    expectedProjectId?: string | null;
    readonly requestId: string;
    readonly originDb: Or3DB;
    readonly workspaceId: string;
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
};

export function createChatRequest(options: {
    requestId: string;
    originDb: Or3DB;
    workspaceId: string;
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
    const target =
        view.tailAssistant.value?.id === id
            ? view.tailAssistant.value
            : (view.messages.value.find((message) => message.id === id) ??
              request.message);
    if (!target) return;
    target.text = terminal.content ?? target.text;
    target.reasoning_text = terminal.reasoning ?? undefined;
    if (terminal.toolCalls !== undefined)
        target.toolCalls = terminal.toolCalls ?? undefined;
    target.pending = false;
    target.error =
        terminal.messageError ??
        (result.persistenceError ? 'stream_interrupted' : null);
    const raw = view.rawMessages.value.find((message) => message.id === id);
    if (raw) {
        raw.content = target.text;
        raw.reasoning_text = terminal.reasoning ?? null;
        raw.error = target.error;
        raw.pending = false;
    }
    if (
        terminal.outcome === 'aborted' &&
        !view.messages.value.some((message) => message.id === id)
    )
        view.messages.value.push(target);
    view.messages.value = [...view.messages.value];
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
    request.terminal = terminal;
    request.phase.value = 'finalizing';
    // Scheduling the body also ensures finalization is assigned before a
    // projection or hook can synchronously deliver another terminal callback.
    request.finalization = Promise.resolve().then(async () => {
        const result: RequestFinalization = {
            terminal,
            deleted: false,
            superseded: false,
        };
        try {
            await terminal.beforePersist?.();
        } catch (error) {
            result.effectError = error;
        }
        try {
            if (terminal.persistence === 'tracker') {
                request.persistence.value = 'tracker';
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
                        !latest ||
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
                const latest = (await request.originDb.messages.get(
                    request.assistantMessageId
                )) as StoredMessage | undefined;
                if (ifCurrent(latest)) {
                    const hasOutput = Boolean(
                        terminal.content ||
                        terminal.reasoning ||
                        terminal.toolCalls?.length ||
                        request.message?.file_hashes?.length
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
            if (!result.persistenceError && !result.superseded)
                await terminal.afterPersist?.();
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
        return result;
    });
    return request.finalization;
}
