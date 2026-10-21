import { err } from '~/utils/errors';
/** Cloud exposes connection metadata; static deployments retain device-local BYOK. */
import Dexie from 'dexie';
import { useRuntimeConfig, useState } from '#imports';
import type { SessionPayload } from '~/composables/auth/useSessionContext';
import { computed, ref } from 'vue';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { kv } from '~/db';
import { state } from '~/state/global';

const cloudConnection = ref<{ owner: string; connected: boolean } | null>(null);
const cleanedOwners = new Set<string>();
const cloudMode = () => useRuntimeConfig().public.ssrAuthEnabled === true;
let pendingConnection: { owner: string; promise: Promise<void> } | null = null;

async function credentialRequest(operation: string, key?: string) {
    const owner = currentKeyOwner();
    if (owner === 'guest' || owner === 'local') throw new Error('Sign in to connect OpenRouter.');
    // A mutation fences status reads both before it starts and while it runs.
    const generation = operation === 'status' ? kvHydrationGeneration : ++kvHydrationGeneration;
    const response = await fetch('/api/openrouter/credentials', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', 'x-or3-account': owner },
        body: JSON.stringify({ operation, ...(key === undefined ? {} : { key }) }),
    });
    if (!response.ok) throw new Error(response.status === 409 ? 'The server connection changed. Refresh and try again.' : 'OpenRouter credential storage is unavailable. Try again or contact the administrator.');
    const result = await response.json() as { connected?: unknown; persisted?: unknown };
    if (typeof result.connected !== 'boolean' || typeof result.persisted !== 'boolean') throw new Error('Invalid connection response.');
    if (owner !== currentKeyOwner() || generation !== kvHydrationGeneration) throw new Error('The connection or signed-in account changed.');
    if (operation !== 'status') ++kvHydrationGeneration;
    state.value.openrouterKey = null;
    cloudConnection.value = { owner, connected: result.connected };
    return { owner, connected: result.connected, persisted: result.persisted };
}

/** Read only owner-tagged legacy values; an unowned key can never prove account ownership. */
async function legacyKey(owner: string): Promise<string | null> {
    const read = async (db: Dexie) => {
        if (!hasKvTable(db)) return null;
        const rows = await db.table<KvApiKeyRow, string>('kv').where('name').equals('openrouter_api_key').toArray();
        for (const row of rows) {
            const key = typeof row.value === 'string' ? storedKey(row.value, owner) : null;
            if (key && isValidOpenRouterKeyFormat(key)) return key;
        }
        return null;
    };
    const db = getDb();
    const active = await read(db);
    if (active) return active;
    try {
        const value = localStorage.getItem('openrouter_api_key');
        const key = value ? storedKey(value, owner) : null;
        if (key && isValidOpenRouterKeyFormat(key)) return key;
    } catch { /* Storage may be unavailable. */ }
    for (const name of await Dexie.getDatabaseNames()) {
        if (!(name === 'or3-db' || name.startsWith('or3-db-')) || name === db.name) continue;
        const retained = new Dexie(name);
        try { await retained.open(); const key = await read(retained); if (key) return key; }
        catch { /* Preserve inaccessible legacy databases. */ }
        finally { retained.close(); }
    }
    return null;
}

/** Only called after persistence or an existing server tombstone has been verified. */
async function discardLegacyKeys(owner: string): Promise<boolean> {
    const current = () => owner === currentKeyOwner();
    let complete = true;
    const clean = async (db: Dexie) => {
        if (!hasKvTable(db)) return;
        const table = db.table<KvApiKeyRow, string>('kv');
        await db.transaction('rw', table, async () => {
            const rows = await table.where('name').equals('openrouter_api_key').toArray();
            for (const row of rows) if (current() && typeof row.value === 'string' && storedKey(row.value, owner) !== null) await table.delete(row.id);
        });
    };
    let activeName: string | undefined;
    try { const db = getDb(); activeName = db.name; await clean(db); }
    catch { complete = false; }
    try {
        const names = await Dexie.getDatabaseNames();
        await Promise.all(names.filter(name => (name === 'or3-db' || name.startsWith('or3-db-')) && name !== activeName).map(async name => {
            const retained = new Dexie(name);
            try { await retained.open(); await clean(retained); }
            catch { complete = false; }
            finally { retained.close(); }
        }));
    } catch { complete = false; }
    try {
        const value = localStorage.getItem('openrouter_api_key');
        if (current() && value && storedKey(value, owner) !== null) localStorage.removeItem('openrouter_api_key');
    } catch { complete = false; }
    // Inaccessible copies cannot invalidate a verified save. Retry on reconnect.
    return complete && current();
}

export async function refreshOpenRouterConnection(): Promise<void> {
    if (!cloudMode() || currentKeyOwner() === 'guest') return;
    const owner = currentKeyOwner();
    if (pendingConnection?.owner === owner) return pendingConnection.promise;
    const promise = (async () => {
        const result = await credentialRequest('status');
        if (result.persisted && !cleanedOwners.has(owner)) {
            if (await discardLegacyKeys(owner)) cleanedOwners.add(owner);
        }
    })().finally(() => { if (pendingConnection?.promise === promise) pendingConnection = null; });
    pendingConnection = { owner, promise };
    return promise;
}

export async function findLegacyOpenRouterKey(): Promise<boolean> {
    if (!cloudMode() || currentKeyOwner() === 'guest') return false;
    const owner = currentKeyOwner();
    return Boolean(await legacyKey(owner)) && owner === currentKeyOwner();
}

export async function migrateLegacyOpenRouterKey(): Promise<void> {
    const owner = currentKeyOwner();
    const key = await legacyKey(owner);
    if (!cloudMode() || !key || owner === 'guest' || owner !== currentKeyOwner()) throw new Error('No legacy key belongs to this account.');
    const result = await credentialRequest('migrate', key);
    if (result.persisted) await discardLegacyKeys(owner);
}

export async function disconnectOpenRouterConnection(): Promise<void> {
    if (cloudMode()) {
        const result = await credentialRequest('delete');
        if (result.persisted) await discardLegacyKeys(result.owner);
    } else await clearPersistedUserApiKey();
}

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

/** Save in the account vault on Cloud, or device-local KV on static deployments. */
export async function persistUserApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!isValidOpenRouterKeyFormat(trimmed)) {
        throw err('ERR_VALIDATION',
            `That doesn't look like an OpenRouter API key. Keys start with "${OPENROUTER_KEY_PREFIX}" — get yours at openrouter.ai/keys.`
        );
    }
    if (cloudMode()) {
        const result = await credentialRequest('save', trimmed);
        if (result.persisted) await discardLegacyKeys(result.owner);
        window.dispatchEvent(new CustomEvent('openrouter:connected'));
        return;
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
    if (cloudMode()) { state.value.openrouterKey = null; return Promise.resolve(); }
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
                cloudMode() || hydrationGeneration !== kvHydrationGeneration ||
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
    cloudConnection.value = null;
    if (cloudMode()) return; // Logout never deletes a server credential or an unverified migration source.
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
        state.value.openrouterKey = cloudMode() ? null : key;
    }

    function clearKey() {
        kvHydrationGeneration += 1;
        state.value.openrouterKey = null;
    }

    // Return a computed ref so callers can read `apiKey.value` and
    // still observe changes made to the shared state.
    const apiKey = computed(() => cloudMode() ? null : state.value.openrouterKey) as {
        readonly value: string | null;
    };

    return {
        apiKey,
        connected: computed(() => cloudMode() ? cloudConnection.value?.owner === currentKeyOwner() && cloudConnection.value.connected : Boolean(state.value.openrouterKey)),
        setKey,
        clearKey,
    };
}
