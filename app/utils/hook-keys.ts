// Centralized hook key typings and high-value payload interfaces.
// This file complements the generic HookEngine and improves DX for common hooks
// without constraining advanced usage. Keep additive and backwards compatible.

import type { HookEngine, OnOptions } from './hooks';

// ---- Payload interfaces (chat send/stream) ----

export interface AiSendBefore {
    threadId?: string;
    modelId: string;
    user: { id: string; length: number };
    assistant: { id: string; streamId: string };
    messagesCount?: number;
}

export interface AiSendAfterTimings {
    startedAt: number;
    endedAt: number;
    durationMs: number;
}

export interface AiSendAfter {
    threadId?: string;
    request?: { modelId?: string; userId?: string };
    response?: { assistantId?: string; length?: number };
    timings?: AiSendAfterTimings;
    aborted?: boolean;
}

export interface AiStreamDeltaCtx {
    threadId?: string;
    assistantId: string;
    streamId: string;
    deltaLength: number;
    totalLength: number;
    chunkIndex: number;
}

export interface AiStreamReasoningCtx {
    threadId?: string;
    assistantId: string;
    streamId: string;
    reasoningLength: number;
}

export interface AiStreamCompleteCtx {
    threadId?: string;
    assistantId: string;
    streamId: string;
    totalLength: number;
    reasoningLength?: number;
    fileHashes?: string | null;
}

export interface AiStreamErrorCtx {
    threadId?: string;
    streamId?: string;
    error?: unknown;
    aborted?: boolean;
}

export interface UiPaneMsgSentPayload {
    id: string;
    paneIndex?: number;
    threadId?: string;
    length?: number;
    fileHashes?: string | null;
}

export interface UiPaneMsgReceivedPayload extends UiPaneMsgSentPayload {
    reasoningLength?: number;
}

// ---- Key unions ----

// High-signal known hooks used across the app (enumerated for best DX)
export type KnownHookKey =
    | 'ui.chat.message:filter:outgoing'
    | 'ui.chat.message:filter:incoming'
    | 'ai.chat.model:filter:select'
    | 'ai.chat.messages:filter:input'
    | 'ai.chat.send:action:before'
    | 'ai.chat.send:action:after'
    | 'ai.chat.stream:action:delta'
    | 'ai.chat.stream:action:reasoning'
    | 'ai.chat.stream:action:complete'
    | 'ai.chat.stream:action:error'
    | 'ai.chat.retry:action:before'
    | 'ai.chat.retry:action:after'
    | 'ui.pane.active:action'
    | 'ui.pane.blur:action'
    | 'ui.pane.switch:action'
    | 'ui.pane.thread:filter:select'
    | 'ui.pane.thread:action:changed'
    | 'ui.pane.doc:filter:select'
    | 'ui.pane.doc:action:changed'
    | 'ui.pane.doc:action:saved'
    | 'ui.pane.msg:action:sent'
    | 'ui.pane.msg:action:received';

// Families for DB hooks as template literal types (broad coverage without listing all)
export type DbFamily =
    | 'messages'
    | 'documents'
    | 'files'
    | 'threads'
    | 'projects'
    | 'posts'
    | 'prompts'
    | 'attachments'
    | 'kv';

export type DbHookKey = `db.${DbFamily}.${string}`;

// Final public key union — includes known app hooks and DB families; allows any string to remain permissive
export type HookKey = KnownHookKey | DbHookKey | (string & {});

// ---- Typed ON helper ----

// Map known keys to their argument tuple for `on()` convenience.
// Note: filters vs actions are not distinguished here; the engine decides based on opts.kind.
export interface HookPayloads {
    'ai.chat.send:action:before': [AiSendBefore];
    'ai.chat.send:action:after': [AiSendAfter];
    'ai.chat.stream:action:delta': [string, AiStreamDeltaCtx];
    'ai.chat.stream:action:reasoning': [string, AiStreamReasoningCtx];
    'ai.chat.stream:action:complete': [AiStreamCompleteCtx];
    'ai.chat.stream:action:error': [AiStreamErrorCtx];
    'ui.pane.msg:action:sent': [any, UiPaneMsgSentPayload];
    'ui.pane.msg:action:received': [any, UiPaneMsgReceivedPayload];
    'ui.pane.active:action': [any, number, number | undefined];
    'ui.pane.blur:action': [any, number];
    'ui.pane.switch:action': [any, number];
    'ui.pane.thread:filter:select': [string];
    'ui.pane.thread:action:changed': [any, string | '', string, number];
    'ui.pane.doc:filter:select': [string];
    'ui.pane.doc:action:changed': [any, string | '', string];
    'ui.pane.doc:action:saved': [any, string];
    'ui.chat.message:filter:outgoing': [string];
    'ui.chat.message:filter:incoming': [string, string | undefined];
    'ai.chat.model:filter:select': [string];
    'ai.chat.messages:filter:input': [any[]];
    'ai.chat.retry:action:before': [
        {
            threadId?: string;
            originalUserId: string;
            originalAssistantId?: string;
            triggeredBy: 'user' | 'assistant';
        }
    ];
    'ai.chat.retry:action:after': [
        {
            threadId?: string;
            originalUserId: string;
            originalAssistantId?: string;
            newUserId?: string;
            newAssistantId?: string;
        }
    ];
}

type KnownKey = keyof HookPayloads & KnownHookKey;

export function typedOn(hooks: HookEngine) {
    return {
        on<K extends KnownKey>(
            key: K,
            fn: (...args: HookPayloads[K]) => any,
            opts?: OnOptions
        ) {
            return hooks.on(key, fn as any, opts);
        },
    } as const;
}

// Utility aliases for filter return shapes (documentation aid)
export type ChatOutgoingFilterReturn = string | false;
export type ChatIncomingFilterReturn = string;

// Keep this file small and focused. Add new keys/payloads incrementally as they stabilize.
