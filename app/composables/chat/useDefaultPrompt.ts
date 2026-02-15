/**
 * @module composables/chat/useDefaultPrompt
 *
 * **Purpose**
 * Manages the user's default system prompt preference. Persists the default prompt ID
 * to the local Dexie KV store and provides reactive state for UI consumption. Used to
 * automatically select a prompt on chat initialization if no explicit prompt is chosen.
 *
 * **Responsibilities**
 * - Load default prompt ID from KV store on first access
 * - Persist default prompt ID changes to KV store
 * - Emit hooks when default prompt is updated
 * - Provide readonly reactive state for UI consumption
 * - Lazy-load state on first access (SSR-safe)
 *
 * **Non-responsibilities**
 * - Does NOT manage the prompts database table (see db/prompts)
 * - Does NOT apply prompts to messages (see useAi.ts)
 * - Does NOT auto-select prompt on chat load (caller must check and apply)
 * - Does NOT validate prompt ID exists (caller should check if needed)
 *
 * **Singleton State Pattern**
 * - Module-scoped ref (`_defaultPromptId`) ensures all callers share state
 * - Readonly export prevents external mutation while allowing reactive subscriptions
 * - State is lazy-loaded once on first access via `loadOnce()`
 * - Subsequent calls to `useDefaultPrompt()` reuse loaded state
 * - State persists across component mount/unmount (session lifetime)
 * - Persisted to DB KV store (survives page reload)
 *
 * **Lifecycle**
 * - First call triggers lazy load from KV store (async)
 * - `setDefaultPrompt(id)` updates in-memory state and persists to KV
 * - `clearDefaultPrompt()` sets to `null` and persists
 * - State is NOT cleared on HMR (requires manual clear or page reload)
 *
 * **Storage**
 * - Stored in KV table with key `'default_system_prompt_id'`
 * - Value is prompt ID string or `null`
 * - Uses `setKvByName` helper for persistence
 *
 * **Hook Emission**
 * - Fires `chat.systemPrompt.default:action:update` when default is changed
 * - Hook receives new default ID (or null if cleared)
 *
 * **Error Handling**
 * - Load errors from KV store are swallowed; state defaults to `null`
 * - Write errors should propagate to caller (not swallowed by setKvByName)
 */

import { ref, readonly } from 'vue';
import { getDb } from '~/db/client';
import { setKvByName } from '~/db/kv';
import { useHooks } from '#imports';

// Singleton state (module scope) so all importers share
const _defaultPromptId = ref<string | null>(null);
let _loaded = false;
let _loadedDbName: string | null = null;

/**
 * Lazy-loads default prompt ID from KV store (once per session).
 *
 * **Behavior**
 * - Guarded by `_loaded` flag (idempotent)
 * - Queries KV store for key `'default_system_prompt_id'`
 * - Sets `_defaultPromptId` to stored value or `null`
 *
 * **Error Handling**
 * - Load errors are swallowed; state defaults to `null`
 */
async function loadOnce() {
    const db = getDb();
    if (_loaded && _loadedDbName === db.name) return;
    _loaded = true;
    _loadedDbName = db.name;
    try {
        const rec = await db.kv
            .where('name')
            .equals('default_system_prompt_id')
            .first();
        if (rec && typeof rec.value === 'string' && rec.value) {
            _defaultPromptId.value = rec.value;
        } else {
            _defaultPromptId.value = null;
        }
    } catch {
        _defaultPromptId.value = null;
    }
}

/**
 * Composable for managing default system prompt preference.
 *
 * **Behavior**
 * - Returns readonly reactive state for `defaultPromptId`
 * - Provides functions to set/clear the default prompt
 * - Lazy-loads state from KV store on first access (client-side only)
 * - Shares singleton state across all callers
 *
 * @returns Object with reactive state and control functions
 * @returns {Readonly<Ref<string | null>>} defaultPromptId - Default prompt ID
 * @returns {(id: string | null) => Promise<void>} setDefaultPrompt - Set default prompt by ID
 * @returns {() => Promise<void>} clearDefaultPrompt - Clear default prompt
 * @returns {() => Promise<void>} ensureLoaded - Force load state (SSR safety guard)
 */
export function useDefaultPrompt() {
    const hooks = useHooks();
    if (import.meta.client) void loadOnce();

    /**
     * Sets the default system prompt by ID.
     *
     * **Behavior**
     * - Ensures state is loaded first
     * - Updates module-scoped state
     * - Persists to KV store via `setKvByName`
     * - Emits `chat.systemPrompt.default:action:update` hook
     *
     * **Error Handling**
     * - Write errors from `setKvByName` propagate to caller
     *
     * @param id - Prompt ID to set as default, or `null` to clear
     */
    async function setDefaultPrompt(id: string | null) {
        await loadOnce();
        const newId = id || null;
        _defaultPromptId.value = newId;
        await setKvByName('default_system_prompt_id', newId);
        await hooks.doAction('chat.systemPrompt.default:action:update', newId);
    }

    /**
     * Clears the default system prompt.
     *
     * **Behavior**
     * - Equivalent to `setDefaultPrompt(null)`
     * - Persists change to KV store
     */
    async function clearDefaultPrompt() {
        await setDefaultPrompt(null);
    }

    const defaultPromptId = readonly(_defaultPromptId);

    return {
        defaultPromptId,
        setDefaultPrompt,
        clearDefaultPrompt,
        // low-level ensure load (mainly for SSR safety guards)
        ensureLoaded: loadOnce,
    };
}

/**
 * Gets the default prompt ID directly from KV store (bypasses composable state).
 *
 * **Behavior**
 * - Queries KV store for key `'default_system_prompt_id'`
 * - Returns prompt ID or `null`
 *
 * **Use Case**
 * - Useful when composable state is not yet loaded or in non-reactive contexts
 * - Prefer `useDefaultPrompt().defaultPromptId` for reactive UI updates
 *
 * **Error Handling**
 * - Load errors are swallowed; returns `null`
 *
 * @returns Promise resolving to default prompt ID or `null`
 */
export async function getDefaultPromptId(): Promise<string | null> {
    try {
        const db = getDb();
        const rec = await db.kv
            .where('name')
            .equals('default_system_prompt_id')
            .first();
        return rec && typeof rec.value === 'string' && rec.value
            ? rec.value
            : null;
    } catch {
        return null;
    }
}
