// Centralized hook key typings and high-value payload interfaces.
// This file complements the generic HookEngine and improves DX for common hooks
// without constraining advanced usage. Keep additive and backwards compatible.

import type { HookEngine, OnOptions } from './hooks';
import type { HookPayloadMap, FilesAttachInputPayload } from './hook-types';

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
    | 'files.attach:filter:input'
    | 'sync.bootstrap:action:start'
    | 'sync.bootstrap:action:progress'
    | 'sync.bootstrap:action:complete'
    | 'sync.pull:action:received'
    | 'sync.pull:action:applied'
    | 'sync.pull:action:error'
    | 'sync.pull:action:after'
    | 'sync.subscription:action:statusChange'
    | 'sync.conflict:action:detected'
    | 'sync.op:action:captured'
    | 'sync.push:action:before'
    | 'sync.push:action:after'
    | 'sync.error:action'
    | 'sync.retry:action'
    | 'sync.queue:action:full'
    | 'sync.rescan:action:starting'
    | 'sync.rescan:action:progress'
    | 'sync.rescan:action:completed'
    | 'sync.stats:action';

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

type KnownKey = Extract<keyof HookPayloadMap, KnownHookKey>;

export function typedOn(hooks: HookEngine) {
    return {
        on<K extends KnownKey>(
            key: K,
            fn: (...args: HookPayloadMap[K]) => unknown,
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
