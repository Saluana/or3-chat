import type { Message } from '~/db/schema';
import { parseFileHashes } from '~/db/files-util';
import { deriveMessageContent } from './messages';
import type { ChatMessage, ToolCall } from './types';
import { ensureUiMessage, type ToolCallInfo, type UiChatMessage } from './uiMessages';
import {
    canonicalToolResult,
    canonicalToolResultData,
} from '~~/shared/chat/canonical-tool-transcript';

export const TRANSCRIPT_VERSION = 1 as const;

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
    error?: string | null;
}

type StoredTranscriptMessage = Message & {
    content?: ChatMessage['content'];
};

const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

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
    const parentAssistantId =
        typeof data.parent_assistant_id === 'string'
            ? data.parent_assistant_id
            : typeof data.parent_turn_id === 'string' && kind === 'tool_result'
              ? data.parent_turn_id
              : '';
    const rawToolCalls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
    const toolCalls = rawToolCalls.flatMap((value): CanonicalToolCall[] => {
        const call = asObject(value);
        const callId = typeof call.id === 'string' ? call.id : '';
        const name = typeof call.name === 'string' ? call.name : '';
        if (!callId || !name) return [];
        return [{
            callId,
            parentAssistantId: message.id,
            name,
            arguments: typeof call.args === 'string' ? call.args : '',
            fingerprint:
                typeof call.fingerprint === 'string' ? call.fingerprint : undefined,
            status:
                call.status === 'complete' || call.status === 'error' ||
                call.status === 'pending' ? call.status : 'loading',
            result: typeof call.result === 'string' ? call.result : undefined,
            error: typeof call.error === 'string' ? call.error : undefined,
        }];
    });
    const generationId =
        typeof data.generation_id === 'string' ? data.generation_id : null;

    return {
        id: message.id,
        threadId: message.thread_id,
        role: message.role as ChatMessage['role'],
        kind,
        content: deriveMessageContent({ content: message.content, data }),
        reasoning:
            typeof data.reasoning_text === 'string' ? data.reasoning_text : null,
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
        error:
            message.error ??
            (typeof data.tool_error === 'string' ? data.tool_error : null),
    };
}

/** Reconciles completed tool rows into their parent assistant call state. */
export function reconcileTranscriptToolState(
    records: CanonicalTranscriptRecord[]
): CanonicalTranscriptRecord[] {
    const resultByCall = new Map(
        records
            .filter((record) => record.kind === 'tool_result' && record.callId)
            .map((record) => [record.callId!, record])
    );
    return records.map((record) => {
        if (record.kind !== 'assistant' || !record.toolCalls.length) return record;
        return {
            ...record,
            toolCalls: record.toolCalls.map((call) => {
                const result = resultByCall.get(call.callId);
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
    return reconcileTranscriptToolState(input).map((record) => {
        const toolCalls: ToolCall[] | undefined = record.toolCalls.length
            ? record.toolCalls.map((call) => ({
                  id: call.callId,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
              }))
            : undefined;
        return {
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
                })),
            },
        };
    });
}

export function projectTranscriptForUi(
    input: CanonicalTranscriptRecord[]
): UiChatMessage[] {
    return projectTranscriptForOpenRouter(input)
        .filter((message) => message.role !== 'tool')
        .map(ensureUiMessage);
}

export function storedMessagesToCanonicalTranscript(
    messages: StoredTranscriptMessage[]
): CanonicalTranscriptRecord[] {
    return reconcileTranscriptToolState(messages.map(messageToCanonicalTranscript));
}
