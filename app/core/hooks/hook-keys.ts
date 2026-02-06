/**
 * @module app/core/hooks/hook-keys.ts
 *
 * Purpose:
 * Centralized hook key typings and high-value payload interfaces.
 * Complements the generic HookEngine with enumerated, well-known hook names
 * that improve autocomplete and refactoring confidence.
 *
 * Responsibilities:
 * - Define `KnownHookKey` union for the most commonly used hooks
 * - Define `DbHookKey` template literal type for database table hooks
 * - Export `HookKey` as the union of known + DB + arbitrary string hooks
 * - Provide `typedOn()` helper for type-safe listener registration
 * - Document filter return shapes via utility aliases
 *
 * Constraints:
 * - Keep this file small and focused; add new keys incrementally as they stabilize
 * - `HookKey` remains permissive (`string & {}`) so plugins can register custom hooks
 * - This file is types-only except for `typedOn()` which is a thin runtime wrapper
 *
 * @see core/hooks/hook-types.ts for full payload map and type utilities
 * @see core/hooks/typed-hooks.ts for the full TypedHookEngine wrapper
 */

import type { HookEngine, OnOptions } from './hooks';
import type { HookPayloadMap, FilesAttachInputPayload } from './hook-types';

// ---- Key unions ----

// High-signal known hooks used across the app (enumerated for best DX)
/**
 * Purpose:
 * Curated union of high-frequency hook keys used across core UI and sync.
 *
 * Constraints:
 * - Keep this list stable; add only after a hook name is widely adopted
 */
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
    | 'sync.stats:action'
    | 'notify:action:push'
    | 'notify:action:read'
    | 'notify:action:clicked'
    | 'notify:action:cleared'
    | 'notify:filter:before_store';

// Families for DB hooks as template literal types (broad coverage without listing all)
/**
 * Purpose:
 * Enumerates Dexie tables that may emit DB-related hooks.
 */
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

/**
 * Purpose:
 * Template-literal key family for DB hooks.
 *
 * Example:
 * - `db.messages.afterPut`
 */
export type DbHookKey = `db.${DbFamily}.${string}`;

// Final public key union — includes known app hooks and DB families; allows any string to remain permissive
/**
 * Purpose:
 * Public hook key type used by plugins.
 *
 * Constraints:
 * - Remains permissive so third-party plugins can define custom keys
 */
export type HookKey = KnownHookKey | DbHookKey | (string & {});

// ---- Typed ON helper ----

type KnownKey = Extract<keyof HookPayloadMap, KnownHookKey>;

/**
 * Purpose:
 * Thin helper that adds type inference when registering listeners for known hook keys.
 *
 * Behavior:
 * Returns an object with a typed `on()` wrapper.
 */
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
/**
 * Purpose:
 * Return type for `ui.chat.message:filter:outgoing`.
 *
 * Veto semantics:
 * - Return `false` to cancel send entirely
 */
export type ChatOutgoingFilterReturn = string | false;

/**
 * Purpose:
 * Return type for `ui.chat.message:filter:incoming`.
 */
export type ChatIncomingFilterReturn = string;

/**
 * Purpose:
 * Return type for `files.attach:filter:input`.
 *
 * Veto semantics:
 * - Return `false` to reject attachments
 */
export type FilesAttachFilterReturn = FilesAttachInputPayload | false;

// Keep this file small and focused. Add new keys/payloads incrementally as they stabilize.
