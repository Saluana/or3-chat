import { kv } from '~/db';
import { state } from '~/state/global';
import { clearWorkspaceDbsOnLogout } from '~/utils/workspace-db-logout';

type SyncEngine = { stop?: () => Promise<void> | void };

// Use 'any' for nuxtApp to avoid weak type detection errors against NuxtApp interface
export async function logoutCleanup(nuxtApp?: any) {
    try {
        await (nuxtApp as { $syncEngine?: SyncEngine })?.$syncEngine?.stop?.();
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
