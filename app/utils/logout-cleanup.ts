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
import { state } from '~/state/global';
import { clearWorkspaceDbsOnLogout } from '~/utils/workspace-db-logout';

type SyncEngine = { stop?: () => Promise<void> | void };

interface NuxtAppWithSync extends NuxtApp {
    $syncEngine?: SyncEngine;
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
export async function logoutCleanup(nuxtApp?: NuxtAppWithSync) {
    try {
        await nuxtApp?.$syncEngine?.stop?.();
    } catch {
        // Best-effort; sync engine may already be stopped.
    }

    await clearWorkspaceDbsOnLogout();

    // Clear user-scoped auth data
    try {
        await kv.delete('openrouter_api_key');
    } catch {
        // Best-effort.
    }
    state.value.openrouterKey = null;

    // Clear local/session storage auth remnants and transient caches
    if (typeof localStorage !== 'undefined') {
        [
            'openrouter_api_key',
            'openrouter_state',
            'openrouter_code_verifier',
            'openrouter_code_method',
            'or3:server-route-available',
            'or3:background-streaming-available',
            'or3.tools.enabled',
            'last_selected_model',
        ].forEach((key) => localStorage.removeItem(key));
    }
    if (typeof sessionStorage !== 'undefined') {
        [
            'openrouter_state',
            'openrouter_code_verifier',
            'openrouter_code_method',
        ].forEach((key) => sessionStorage.removeItem(key));
    }

    // Clear cached workspace list
    try {
        await kv.delete('workspace.manager.cache');
    } catch {
        // Best-effort.
    }
}
