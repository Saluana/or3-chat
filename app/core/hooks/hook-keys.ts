// Centralized hook key typings and high-value payload interfaces.
// This file complements the generic HookEngine and improves DX for common hooks
// without constraining advanced usage. Keep additive and backwards compatible.

import type { HookEngine, OnOptions } from './hooks';
import type {
    AiSendBeforePayload,
    AiSendAfterPayload,
    AiStreamDeltaPayload,
    AiStreamReasoningPayload,
    AiStreamCompletePayload,
    AiStreamErrorPayload,
    AiRetryBeforePayload,
    AiRetryAfterPayload,
    UiPaneMsgSentPayload,
    UiPaneMsgReceivedPayload,
    UiPaneActivePayload,
    UiPaneBlurPayload,
    UiPaneSwitchPayload,
    UiPaneThreadChangedPayload,
    UiPaneDocChangedPayload,
    FilesAttachInputPayload,
} from './hook-types';
import type { ChatMessage } from '~/utils/chat/types';

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
    | 'ui.pane.msg:action:received'
    | 'files.attach:filter:input';

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
    'ai.chat.send:action:before': [AiSendBeforePayload];
    'ai.chat.send:action:after': [AiSendAfterPayload];
    'ai.chat.stream:action:delta': [string, AiStreamDeltaPayload];
    'ai.chat.stream:action:reasoning': [string, AiStreamReasoningPayload];
    'ai.chat.stream:action:complete': [AiStreamCompletePayload];
    'ai.chat.stream:action:error': [AiStreamErrorPayload];
    'ui.pane.msg:action:sent': [UiPaneMsgSentPayload];
    'ui.pane.msg:action:received': [UiPaneMsgReceivedPayload];
    'ui.pane.active:action': [UiPaneActivePayload];
    'ui.pane.blur:action': [UiPaneBlurPayload];
    'ui.pane.switch:action': [UiPaneSwitchPayload];
    'ui.pane.thread:filter:select': [
        string,
        UiPaneThreadChangedPayload['pane'],
        string
    ];
    'ui.pane.thread:action:changed': [UiPaneThreadChangedPayload];
    'ui.pane.doc:filter:select': [
        string,
        UiPaneDocChangedPayload['pane'],
        string
    ];
    'ui.pane.doc:action:changed': [UiPaneDocChangedPayload];
    'ui.pane.doc:action:saved': [UiPaneDocChangedPayload];
    'ui.chat.message:filter:outgoing': [string];
    'ui.chat.message:filter:incoming': [string, string | undefined];
    'ai.chat.model:filter:select': [string];
    'ai.chat.messages:filter:input': [ChatMessage[]];
    'files.attach:filter:input': [FilesAttachInputPayload | false];
    'ai.chat.retry:action:before': [AiRetryBeforePayload];
    'ai.chat.retry:action:after': [AiRetryAfterPayload];
}

type KnownKey = keyof HookPayloads & KnownHookKey;

export function typedOn(hooks: HookEngine) {
    return {
        on<K extends KnownKey>(
            key: K,
            fn: (...args: HookPayloads[K]) => unknown,
            opts?: OnOptions
        ) {
            return hooks.on(key, fn as (...args: unknown[]) => unknown, opts);
        },
    } as const;
}

// Utility aliases for filter return shapes (documentation aid)
export type ChatOutgoingFilterReturn = string | false;
export type ChatIncomingFilterReturn = string;
export type FilesAttachFilterReturn = FilesAttachInputPayload | false;

// Keep this file small and focused. Add new keys/payloads incrementally as they stabilize.
