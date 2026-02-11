/**
 * @module app/core/auth/useUserApiKey
 *
 * Purpose:
 * Vue composable that exposes the user's OpenRouter API key as a reactive
 * computed ref. On first call, hydrates the key from the Dexie KV store
 * into the global reactive state.
 *
 * Behavior:
 * - Reads `openrouter_api_key` from Dexie on initial client-side mount
 * - Returns a reactive `apiKey` computed ref backed by `state.openrouterKey`
 * - `setKey()` / `clearKey()` mutate the shared global state immediately
 *
 * Constraints:
 * - Client-only (Dexie read is guarded by `import.meta.client`)
 * - Does not persist back to KV; callers are responsible for persistence
 * - Relies on `~/state/global` singleton for cross-component reactivity
 *
 * Non-goals:
 * - Does not handle the OAuth flow (see useOpenrouter)
 * - Does not validate the key against OpenRouter
 *
 * @see core/auth/useOpenrouter for login/logout flow
 * @see state/global for the reactive state singleton
 */
import { computed } from 'vue';
import { getDb } from '~/db/client';
import { state } from '~/state/global';

let kvHydrationStarted = false;

type KvApiKeyRow = {
    id: string;
    name: string;
    value?: string | null;
};

function hasKvTable(db: { tables?: Array<{ name?: string }> }): boolean {
    return Array.isArray(db.tables) && db.tables.some((t) => t.name === 'kv');
}

export async function hydrateUserApiKeyFromKv(): Promise<void> {
    let db: ReturnType<typeof getDb>;
    try {
        db = getDb();
    } catch {
        return;
    }

    if (!hasKvTable(db)) return;

    try {
        const kv = db.table<KvApiKeyRow, string>('kv');
        const rec = await kv.where('name').equals('openrouter_api_key').first();
        if (rec && typeof rec.value === 'string') {
            state.value.openrouterKey = rec.value;
        } else if (rec && rec.value == null) {
            state.value.openrouterKey = null;
        }
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[useUserApiKey] kv hydration skipped:', error);
        }
    }
}

/**
 * Purpose:
 * Expose the user's OpenRouter API key as reactive state.
 *
 * Behavior:
 * - Best-effort hydrates `openrouter_api_key` from Dexie KV on the client
 * - Returns a computed ref backed by the global state singleton
 * - `setKey` and `clearKey` update in-memory state immediately
 *
 * Constraints:
 * - Does not persist changes to KV (caller must persist if needed)
 * - Client-only hydration; safe to call in SSR but will not read Dexie
 */
export function useUserApiKey() {
    // Read from Dexie on client without awaiting the composable
    if (import.meta.client && !kvHydrationStarted) {
        kvHydrationStarted = true;
        void hydrateUserApiKeyFromKv();
    }

    function setKey(key: string) {
        state.value.openrouterKey = key;
    }

    function clearKey() {
        state.value.openrouterKey = null;
    }

    // Return a computed ref so callers can read `apiKey.value` and
    // still observe changes made to the shared state.
    const apiKey = computed(() => state.value.openrouterKey) as {
        readonly value: string | null;
    };

    return {
        apiKey,
        setKey,
        clearKey,
    };
}
