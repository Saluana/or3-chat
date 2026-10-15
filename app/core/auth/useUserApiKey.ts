import { err } from '~/utils/errors';
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
 * - `setKey()` / `clearKey()` are in-memory only; use `persistUserApiKey()`
 *   for the canonical paste-key path that writes Dexie KV
 * - Relies on `~/state/global` singleton for cross-component reactivity
 *
 * Non-goals:
 * - Does not handle the OAuth flow (see useOpenrouter)
 *
 * @see core/auth/useOpenrouter for login/logout flow
 * @see state/global for the reactive state singleton
 */
import Dexie from 'dexie';
import { useRuntimeConfig, useState } from '#imports';
import type { SessionPayload } from '~/composables/auth/useSessionContext';
import { computed } from 'vue';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { kv } from '~/db';
import { state } from '~/state/global';

let kvHydrationStarted = false;
let kvHydrationGeneration = 0;
let pendingKvHydration: {
    generation: number;
    workspaceGeneration: number;
    db: ReturnType<typeof getDb>;
    promise: Promise<void>;
} | null = null;

/** Capture credential changes so delayed logout work can reject a newer key. */
export function getUserApiKeyGeneration(): number {
    return kvHydrationGeneration;
}

const OPENROUTER_KEY_PREFIX = 'sk-or-';

function currentKeyOwner(): string {
    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled) return 'local';
    const session = useState<SessionPayload | null>('auth-session', () => null).value?.session;
    return session?.authenticated && session.user?.id ? JSON.stringify([session.provider, session.user.id]) : 'guest';
}

function storedKey(value: string, owner: string): string | null {
    if (owner === 'local') return value;
    try {
        const parsed = JSON.parse(value) as { owner?: unknown; key?: unknown };
        return parsed.owner === owner && typeof parsed.key === 'string' ? parsed.key : null;
    } catch { return null; } // Old unowned credentials cannot be inherited by an account.
}

/**
 * Validates the format of an OpenRouter API key.
 * OpenRouter keys start with `sk-or-` and are long random strings.
 */
export function isValidOpenRouterKeyFormat(key: string): boolean {
    const trimmed = key.trim();
    return (
        trimmed.startsWith(OPENROUTER_KEY_PREFIX) &&
        trimmed.length > OPENROUTER_KEY_PREFIX.length + 8
    );
}

/**
 * Persists an OpenRouter API key the same way the OAuth callback does:
 * writes it to the Dexie `kv` table (survives reloads), updates the global
 * reactive state, and notifies listeners via `openrouter:connected`.
 *
 * This is the canonical "paste a key" path — callers must use this instead
 * of only mutating in-memory state (which loses the key on reload).
 *
 * @throws Error when the key fails format validation.
 */
export async function persistUserApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!isValidOpenRouterKeyFormat(trimmed)) {
        throw err('ERR_VALIDATION',
            `That doesn't look like an OpenRouter API key. Keys start with "${OPENROUTER_KEY_PREFIX}" — get yours at openrouter.ai/keys.`
        );
    }
    // Invalidate an in-flight initial read so an older persisted value cannot
    // overwrite the key the user just supplied.
    const generation = ++kvHydrationGeneration;
    const workspaceGeneration = getWorkspaceGeneration();
    const db = getDb();
    const isCurrent = () =>
        generation === kvHydrationGeneration &&
        workspaceGeneration === getWorkspaceGeneration();
    const owner = currentKeyOwner();
    const value = owner === 'local' ? trimmed : JSON.stringify({ owner, key: trimmed });
    await kv.set('openrouter_api_key', value, db, { isValid: isCurrent });
    if (!isCurrent()) return;
    state.value.openrouterKey = trimmed;
    try {
        window.dispatchEvent(new CustomEvent('openrouter:connected'));
    } catch {
        // Event dispatch may fail in non-browser contexts - non-critical
    }
}

type KvApiKeyRow = {
    id: string;
    name: string;
    value?: string | null;
};

function hasKvTable(db: { tables?: Array<{ name?: string }> }): boolean {
    return Array.isArray(db.tables) && db.tables.some((t) => t.name === 'kv');
}

export function hydrateUserApiKeyFromKv(): Promise<void> {
    const owner = currentKeyOwner();
    const hydrationGeneration = kvHydrationGeneration;
    const workspaceGeneration = getWorkspaceGeneration();
    let db: ReturnType<typeof getDb>;
    try {
        db = getDb();
    } catch {
        return Promise.resolve();
    }

    if (!hasKvTable(db)) return Promise.resolve();
    if (
        pendingKvHydration?.generation === hydrationGeneration &&
        pendingKvHydration.workspaceGeneration === workspaceGeneration &&
        pendingKvHydration.db === db
    ) {
        return pendingKvHydration.promise;
    }

    const promise: Promise<void> = (async () => {
        try {
            const kv = db.table<KvApiKeyRow, string>('kv');
            const rec = await kv.where('name').equals('openrouter_api_key').first();
            if (
                hydrationGeneration !== kvHydrationGeneration ||
                workspaceGeneration !== getWorkspaceGeneration()
            ) {
                return;
            }
            if (rec && typeof rec.value === 'string') {
                state.value.openrouterKey = storedKey(rec.value, owner);
            } else if (rec && rec.value == null) {
                state.value.openrouterKey = null;
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn('[useUserApiKey] kv hydration skipped:', error);
            }
        }
    })().finally(() => {
        if (pendingKvHydration?.promise === promise) pendingKvHydration = null;
    });
    pendingKvHydration = { generation: hydrationGeneration, workspaceGeneration, db, promise };
    return promise;
}

/**
 * Clear the canonical in-memory key and its persisted KV value.
 *
 * The reactive state is cleared before awaiting storage so callers cannot use
 * a key during a slow IndexedDB delete. The generation guard also prevents a
 * previously-started hydration read from restoring the key after logout.
 */
export async function clearPersistedUserApiKey(): Promise<void> {
    const generation = ++kvHydrationGeneration;
    state.value.openrouterKey = null;
    const db = getDb();
    await kv.delete('openrouter_api_key', db, {
        isValid: () => generation === kvHydrationGeneration,
    });
    // Enumerate retained databases independently of conversation retention policy.
    const names = await Dexie.getDatabaseNames();
    await Promise.allSettled(names.filter(name => name === 'or3-db' || name.startsWith('or3-db-')).filter(name => name !== db.name).map(async name => {
        const retained = new Dexie(name);
        try {
            await retained.open();
            if (!retained.tables.some(table => table.name === 'kv')) return;
            await retained.transaction('rw', retained.table('kv'), async () => {
                if (generation !== kvHydrationGeneration) return;
                await retained.table('kv').where('name').equals('openrouter_api_key').delete();
            });
        } finally { retained.close(); }
    }));
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
 * - `setKey`/`clearKey` do not write KV — use `persistUserApiKey` to save
 * - Client-only hydration; safe to call in SSR but will not read Dexie
 */
export function useUserApiKey() {
    // Read from Dexie on client without awaiting the composable
    if (import.meta.client && !kvHydrationStarted) {
        kvHydrationStarted = true;
        void hydrateUserApiKeyFromKv();
    }

    function setKey(key: string) {
        kvHydrationGeneration += 1;
        state.value.openrouterKey = key;
    }

    function clearKey() {
        kvHydrationGeneration += 1;
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
