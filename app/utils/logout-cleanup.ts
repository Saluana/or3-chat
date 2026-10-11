/**
 * @module app/utils/logout-cleanup
 *
 * Purpose:
 * Centralizes client-side cleanup on logout to avoid leaving behind
 * user-scoped credentials, caches, or workspace databases.
 *
 * Behavior:
 * - Stops the sync engine if present
 * - Clears workspace databases based on per-workspace logout policy
 * - Removes OpenRouter keys and cached flags from KV/local/session storage
 *
 * Constraints:
 * - Best-effort; failures are swallowed to avoid blocking logout
 * - Client-only storage is guarded by `typeof localStorage !== 'undefined'`
 *
 * Non-Goals:
 * - Server-side session invalidation
 * - Auth provider logout flows
 */

import type { NuxtApp } from 'nuxt/app';
import { kv } from '~/db';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { clearPersistedUserApiKey, getUserApiKeyGeneration } from '~/core/auth/useUserApiKey';
import { clearWorkspaceDbsOnLogout } from '~/utils/workspace-db-logout';
import { stopAllPortableClientsAndAwait } from '~/composables/plugins/portable-client-runtime';

type SyncEngine = { stop?: () => Promise<void> | void };

interface NuxtAppWithSync extends NuxtApp {
    $syncEngine?: SyncEngine;
}

interface LogoutCleanupOptions {
    /**
     * Keep device-local plugin secrets during startup reconciliation.
     * An explicit authenticated -> signed-out transition still clears them.
     */
    preservePluginSecrets?: boolean;
    /**
     * Keep the short-lived PKCE markers while the OpenRouter callback is
     * exchanging its authorization code. The callback clears them itself.
     */
    preserveOpenRouterPkce?: boolean;
}

/**
 * `logoutCleanup`
 *
 * Purpose:
 * Performs local cleanup steps for logout.
 *
 * Behavior:
 * - Stops `$syncEngine` if provided
 * - Clears workspace DBs flagged for removal on logout
 * - Clears OpenRouter API keys and transient flags
 */
export async function logoutCleanup(
    nuxtApp?: NuxtAppWithSync,
    options: LogoutCleanupOptions = {}
) {
    // Clear memory and invalidate pending reads before the first await. Start
    // the captured, guarded delete now so late cleanup cannot erase a new key.
    const clearApiKey = clearPersistedUserApiKey().catch(() => {
        // Best-effort; memory is already cleared even if storage fails.
    });

    const syncEngine = nuxtApp?.$syncEngine;
    const keyGeneration = getUserApiKeyGeneration();
    const workspaceGeneration = getWorkspaceGeneration();
    const isCurrent = () =>
        keyGeneration === getUserApiKeyGeneration() &&
        workspaceGeneration === getWorkspaceGeneration();
    let targetDb: ReturnType<typeof getDb> | undefined;
    try {
        targetDb = getDb();
    } catch {
        // Storage can be unavailable; credential invalidation still happened.
    }

    try {
        // Revoke portable activation handles before clearing the session. The
        // server TTL remains the fallback if the browser is already offline.
        await stopAllPortableClientsAndAwait();
    } catch {
        // Best-effort; logout must still clear local state.
    }

    if (!isCurrent()) return;
    try {
        await syncEngine?.stop?.();
    } catch {
        // Best-effort; sync engine may already be stopped.
    }

    await clearApiKey;
    if (!isCurrent()) return;
    await clearWorkspaceDbsOnLogout(isCurrent);
    if (!isCurrent()) return;

    // Clear local/session storage auth remnants and transient caches
    if (typeof localStorage !== 'undefined') {
        const keys = [
            'openrouter_api_key',
            'or3:server-route-available',
            'or3:background-streaming-available',
            'or3.tools.enabled',
            'last_selected_model',
        ];
        if (!options.preserveOpenRouterPkce) {
            keys.push(
                'openrouter_state',
                'openrouter_code_verifier',
                'openrouter_code_method',
            );
        }
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith('or3:bg-client-tool:')) {
                // Logout does not atomically cancel server jobs. Remove all
                // result/identity data while retaining evidence that this
                // opaque call may have executed before a later sign-in.
                localStorage.setItem(key, JSON.stringify({ state: 'running' }));
            } else if (!options.preservePluginSecrets && key && (/^or3\.plugin\..+\.secret\./u.test(key) || key.startsWith('or3.plugin.secret.'))) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
    }
    if (typeof sessionStorage !== 'undefined') {
        if (!options.preserveOpenRouterPkce) {
            [
                'openrouter_state',
                'openrouter_code_verifier',
                'openrouter_code_method',
            ].forEach((key) => sessionStorage.removeItem(key));
        }
    }

    // Clear cached workspace list
    try {
        if (targetDb) {
            await kv.delete('workspace.manager.cache', targetDb, { isValid: isCurrent });
        }
    } catch {
        // Best-effort.
    }
}
