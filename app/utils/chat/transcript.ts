import { readCardOrigin,
    readToolCardStates,
    type CardOrigin,
    type ToolCardStateMap,
} from '~~/shared/chat/tool-card-data';
import { readCompactionData, readRequestUsage, type CompactionData, type RequestUsage } from '~~/shared/chat/compaction';
import type { Message } from '~/db/schema';
import { parseFileHashes } from '~/db/files-util';
import { normalizeStreamingMessage } from './messages';
import type { ChatMessage, ToolCall } from './types';
import { ensureUiMessage, type ToolCallInfo, type UiChatMessage } from './uiMessages';
import {
    canonicalToolResult,
    canonicalToolResultData,
} from '~~/shared/chat/canonical-tool-transcript';

export const TRANSCRIPT_VERSION = 1 as const;

/**
 * Data key marking a row as replaced by a retry. Rows carrying a
 * `superseded_by` message id are excluded from provider context, history
 * reloads, and future sends. Only the selected turn is superseded by an
 * in-thread retry; unrelated later turns remain visible. The old rows are
 * preserved for audit and reload stability.
 */
export const SUPERSEDED_BY_KEY = 'superseded_by' as const;

/** True when a stored row was replaced by a later retry turn. */
export function isSupersededMessage(message: { data?: unknown }): boolean {
    const data =
        message.data && typeof message.data === 'object'
            ? (message.data as Record<string, unknown>)
            : null;
    return (
        typeof data?.[SUPERSEDED_BY_KEY] === 'string' &&
        (data[SUPERSEDED_BY_KEY] as string).length > 0
    );
}

/** Drops retry-superseded rows; returns the input array when none match. */
export function withoutSupersededMessages<T extends { data?: unknown }>(
    rows: T[]
): T[] {
    return rows.some(isSupersededMessage)
        ? rows.filter((row) => !isSupersededMessage(row))
        : rows;
}

export type TranscriptKind = 'user' | 'assistant' | 'tool_result' | 'system';
export type TranscriptTerminalState =
    | 'pending'
    | 'streaming'
    | 'complete'
    | 'failed'
    | 'aborted'
    | 'detached';

export interface CanonicalToolCall {
    callId: string;
    parentAssistantId: string;
    name: string;
    arguments: string;
    fingerprint?: string;
    status: ToolCallInfo['status'];
    result?: string;
    error?: string;
    completedAt?: number;
    /** Length of the assistant text when this call's results arrived; stored as `text_offset`. */
    textOffset?: number;
}

export interface CanonicalGeneration {
    generationId: string;
    requestId: string;
    mode: 'foreground' | 'background' | 'continuation' | 'workflow';
    state: TranscriptTerminalState;
    terminalError?: string | null;
}

export interface CanonicalTranscriptRecord {
    id: string;
    threadId: string;
    role: ChatMessage['role'];
    kind: TranscriptKind;
    content: ChatMessage['content'];
    reasoning: string | null;
    fileHashes: string[];
    index: number;
    orderKey?: string;
    createdAt: number;
    streamId?: string;
    pending: boolean;
    turnId: string;
    parentTurnId?: string;
    parentAssistantId?: string;
    callId?: string;
    toolName?: string;
    toolCalls: CanonicalToolCall[];
    generation?: CanonicalGeneration;
    compaction?: CompactionData;
    usage?: RequestUsage;
    error?: string | null;
    /** Serialized public error envelope of a failed turn (`data.error_envelope`). */
    errorEnvelope?: string;
cardOrigin?: CardOrigin;
    toolCards?: ToolCardStateMap;
}

type StoredTranscriptMessage = Message & {
    content?: ChatMessage['content'];
    reasoning_text?: string | null;
};

const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function readParentAssistantId(data: Record<string, unknown>, isTool: boolean): string | undefined {
    return typeof data.parent_assistant_id === 'string' ? data.parent_assistant_id
        : isTool && typeof data.parent_turn_id === 'string' ? data.parent_turn_id : undefined;
}

const safeFileHashes = (value: string | null | undefined): string[] => {
    if (!value) return [];
    try {
        return parseFileHashes(value);
    } catch {
        return [];
    }
};

export function assistantTranscriptData(params: {
    turnId: string;
    requestId: string;
    generationId: string;
    mode: CanonicalGeneration['mode'];
    state?: TranscriptTerminalState;
}): Record<string, unknown> {
    return {
        transcript_version: TRANSCRIPT_VERSION,
        transcript_kind: 'assistant',
        turn_id: params.turnId,
        parent_turn_id: params.turnId,
        generation_id: params.generationId,
        request_id: params.requestId,
        generation_mode: params.mode,
        generation_state: params.state ?? 'pending',
    };
}

export function userTranscriptData(turnId: string): Record<string, unknown> {
    return {
        transcript_version: TRANSCRIPT_VERSION,
        transcript_kind: 'user',
        turn_id: turnId,
    };
}

export function toolResultTranscriptData(params: {
    turnId: string;
    parentAssistantId: string;
    callId: string;
    toolName: string;
    fingerprint?: string;
    status: 'complete' | 'error';
    result: string;
    error?: string;
}): Record<string, unknown> {
    return canonicalToolResultData(canonicalToolResult(params));
}

export function messageToCanonicalTranscript(
    message: StoredTranscriptMessage
): CanonicalTranscriptRecord {
    const data = asObject(message.data);
    const kind: TranscriptKind =
        message.role === 'tool'
            ? 'tool_result'
            : message.role === 'assistant'
              ? 'assistant'
              : message.role === 'system'
                ? 'system'
                : 'user';
    const parentAssistantId = readParentAssistantId(data, kind === 'tool_result');
    const normalized = normalizeStreamingMessage({
        content: message.content,
        reasoning_text: message.reasoning_text,
        data,
    });
    const toolCalls = normalized.toolCalls.map((call): CanonicalToolCall => ({
            callId: call.id,
            parentAssistantId: message.id,
            name: call.name,
            arguments: call.args ?? '',
            fingerprint: call.fingerprint,
            status: call.status,
            result: call.result,
            error: call.error,
            textOffset: call.text_offset,
        }));
    const generationId =
        typeof data.generation_id === 'string' ? data.generation_id : null;

    return {
        id: message.id,
        threadId: message.thread_id,
        role: message.role as ChatMessage['role'],
        kind,
        content: normalized.text,
        reasoning: normalized.reasoningText,
        fileHashes: safeFileHashes(message.file_hashes),
        index: message.index,
        orderKey: message.order_key,
        createdAt: message.created_at,
        streamId: message.stream_id ?? undefined,
        pending: message.pending === true,
        turnId: typeof data.turn_id === 'string' ? data.turn_id : message.id,
        parentTurnId:
            typeof data.parent_turn_id === 'string' ? data.parent_turn_id : undefined,
        parentAssistantId: parentAssistantId || undefined,
        callId: typeof data.tool_call_id === 'string' ? data.tool_call_id : undefined,
        toolName: typeof data.tool_name === 'string' ? data.tool_name : undefined,
        toolCalls,
        generation: generationId
            ? {
                  generationId,
                  requestId:
                      typeof data.request_id === 'string' ? data.request_id : generationId,
                  mode:
                      data.generation_mode === 'background' ||
                      data.generation_mode === 'continuation' ||
                      data.generation_mode === 'workflow'
                          ? data.generation_mode
                          : 'foreground',
                  state: (
                      data.generation_state === 'pending' ||
                      data.generation_state === 'streaming' ||
                      data.generation_state === 'complete' ||
                      data.generation_state === 'failed' ||
                      data.generation_state === 'aborted' ||
                      data.generation_state === 'detached'
                  )
                      ? data.generation_state
                      : message.pending
                        ? 'streaming'
                        : 'complete',
                  terminalError:
                      typeof data.generation_error === 'string'
                          ? data.generation_error
                          : null,
              }
            : undefined,
        compaction: data.kind === 'compaction' ? readCompactionData(data.compaction) : undefined,
        usage: readRequestUsage(data.usage),
        cardOrigin: readCardOrigin(data.card_origin),
        toolCards: readToolCardStates(data.tool_cards),
        error:
            message.error ??
            (typeof data.tool_error === 'string' ? data.tool_error : null),
        errorEnvelope:
            typeof data.error_envelope === 'string' ? data.error_envelope : undefined,
    };
}

function toolResultKey(threadId: string, parentAssistantId: string | undefined, callId: string): string {
    return JSON.stringify([threadId, parentAssistantId, callId]);
}

/** Reconciles completed tool rows into their parent assistant call state. */
export function reconcileTranscriptToolState(
    records: CanonicalTranscriptRecord[]
): CanonicalTranscriptRecord[] {
    const resultByCall = new Map(
        records
            .filter((record) => record.kind === 'tool_result' && record.callId)
            .map((record) => [toolResultKey(record.threadId, record.parentAssistantId, record.callId!), record])
    );
    return records.map((record) => {
        if (record.kind !== 'assistant' || !record.toolCalls.length) return record;
        return {
            ...record,
            toolCalls: record.toolCalls.map((call) => {
                const result = resultByCall.get(toolResultKey(record.threadId, record.id, call.callId));
                if (!result) return call;
                return {
                    ...call,
                    status: result.error ? 'error' : 'complete',
                    result: typeof result.content === 'string' ? result.content : '',
                    error: result.error ?? undefined,
                };
            }),
        };
    });
}

export function projectTranscriptForOpenRouter(
    input: CanonicalTranscriptRecord[]
): ChatMessage[] {
    const durableResults = new Set(input.filter((record) => record.kind === 'tool_result' && record.callId)
        .map((record) => toolResultKey(record.threadId, record.parentAssistantId, record.callId!)));
    // A result whose recorded assistant is absent (superseded by a retry or
    // removed) answers no call in this history; providers reject the request.
    const assistantIds = new Set(input.filter((record) => record.kind === 'assistant')
        .map((record) => JSON.stringify([record.threadId, record.id])));
    return reconcileTranscriptToolState(input).flatMap((record) => {
        if (record.kind === 'tool_result' && record.parentAssistantId
            && !assistantIds.has(JSON.stringify([record.threadId, record.parentAssistantId]))) return [];
        const toolCalls: ToolCall[] | undefined = record.toolCalls.length
            ? record.toolCalls.map((call) => ({
                  id: call.callId,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
              }))
            : undefined;
        const message: ChatMessage = {
            id: record.id,
            role: record.role,
            content: record.content,
            file_hashes: record.fileHashes.length
                ? JSON.stringify(record.fileHashes)
                : undefined,
            reasoning_text: record.reasoning,
            error: record.error,
            index: record.index,
            order_key: record.orderKey,
            created_at: record.createdAt,
            stream_id: record.streamId,
            pending: record.pending,
            name: record.toolName,
            tool_call_id: record.callId,
            tool_calls: toolCalls,
            data: {
                ...(record.compaction ? { kind: 'compaction', compaction: record.compaction } : {}),
                ...(record.usage ? { usage: record.usage } : {}),
                ...(record.cardOrigin
                    ? { card_origin: record.cardOrigin }
                    : {}),
                ...(record.toolCards ? { tool_cards: record.toolCards } : {}),
                ...(record.errorEnvelope ? { error_envelope: record.errorEnvelope } : {}),
                transcript_version: TRANSCRIPT_VERSION,
                transcript_kind: record.kind,
                turn_id: record.turnId,
                parent_turn_id: record.parentTurnId,
                parent_assistant_id: record.parentAssistantId,
                tool_calls: record.toolCalls.map((call) => ({
                    id: call.callId,
                    name: call.name,
                    args: call.arguments,
                    status: call.status,
                    result: call.result,
                    error: call.error,
                    fingerprint: call.fingerprint,
                    ...(call.textOffset === undefined ? {} : { text_offset: call.textOffset }),
                })),
            },
        };
        // Older/background projections keep completed results on the assistant
        // instead of separate rows. Replay that saved evidence on the wire so
        // the next request has a closed call/result pair. Never write synthetic
        // rows or duplicate a result already present in the durable transcript.
        const embeddedResults: ChatMessage[] = record.kind === 'assistant'
            ? record.toolCalls.filter((call) => typeof call.result === 'string'
                && (call.status === 'complete' || call.status === 'error')
                && !durableResults.has(toolResultKey(record.threadId, record.id, call.callId)))
                .map((call) => ({ id: `${record.id}:tool-result:${call.callId}`, role: 'tool',
                    content: call.result!, name: call.name, tool_call_id: call.callId,
                    data: { parent_assistant_id: record.id, tool_call_id: call.callId, tool_name: call.name } }))
            : [];
        return [message, ...embeddedResults];
    });
}

export function projectTranscriptForUi(
    input: CanonicalTranscriptRecord[]
): UiChatMessage[] {
    return associateUiToolResultMessages(projectTranscriptForOpenRouter(input)
        .filter((message) => message.role !== 'tool').map(ensureUiMessage), input);
}

/** UI-only navigation hints; callers retain their established presentation projection. */
export function associateUiToolResultMessages(messages: UiChatMessage[], input: readonly (CanonicalTranscriptRecord | ChatMessage)[]): UiChatMessage[] {
    // Durable navigation identities only: never fabricate storage records for
    // a provider projection or normalize its historical text a second time.
    const identities = input.flatMap<{
        id: string; role: ChatMessage['role']; threadId?: string;
        parentAssistantId?: string; callId?: string; toolCalls: readonly { callId: string }[];
    }>(row => {
        if ('kind' in row) return [row];
        if (!row.id) return [];
        const data = asObject(row.data);
        return [{ id: row.id, role: row.role, threadId: undefined,
            parentAssistantId: readParentAssistantId(data, row.role === 'tool'),
            callId: row.tool_call_id ?? (typeof data.tool_call_id === 'string' ? data.tool_call_id : undefined),
            toolCalls: normalizeStreamingMessage({ data: { tool_calls: data.tool_calls } }).toolCalls.map(call => ({ callId: call.id })) }];
    });
    const owners = new Map(identities.filter(row => row.role === 'assistant').map(row => [row.id, row]));
    const resultIds = new Map<string, string[]>();
    for (const row of identities) {
        const parent = row.parentAssistantId && owners.get(row.parentAssistantId);
        if (row.role !== 'tool' || !parent || row.threadId !== parent.threadId || !row.callId
            || !parent.toolCalls.some(call => call.callId === row.callId)) continue;
        const ids = resultIds.get(parent.id) ?? []; ids.push(row.id); resultIds.set(parent.id, ids);
    }
    return messages.map(ui => {
        const ids = resultIds.get(ui.id);
        return ids?.length ? { ...ui, toolResultMessageIds: [...new Set(ids)] } : ui;
    });
}

export function storedMessagesToCanonicalTranscript(
    messages: StoredTranscriptMessage[]
): CanonicalTranscriptRecord[] {
    return reconcileTranscriptToolState(messages.map(messageToCanonicalTranscript));
}
