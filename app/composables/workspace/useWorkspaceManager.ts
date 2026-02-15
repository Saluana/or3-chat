/**
 * Unified workspace management composable
 * 
 * This composable consolidates workspace state management to prevent
 * race conditions between multiple plugins trying to set the active workspace.
 * 
 * Key responsibilities:
 * - Single source of truth for active workspace ID
 * - Coordinates workspace changes between DB and sync engine
 * - Prevents duplicate workspace switches
 * 
 * NOTE: This composable uses a module-level flag to prevent concurrent changes.
 * It's designed to be called once per application lifecycle in plugin initialization.
 * Multiple instances will share the same flag, which is intentional for coordination.
 * 
 * Known limitation: In JavaScript's single-threaded event loop, rapid session updates
 * could theoretically trigger the watch callback before the finally block executes.
 * In practice, this is acceptable because workspace changes are relatively infrequent
 * and the watch mechanism processes them synchronously.
 */
import { computed, watch } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';

let workspaceChangeToken = 0;

async function shouldClearWorkspaceForNullSession(oldWorkspaceId: string | null): Promise<boolean> {
    if (!oldWorkspaceId) return true;
    if (!import.meta.client) return true;

    try {
        const { resolveClientAuthStatus } = await import(
            '~/composables/auth/useClientAuthStatus.client'
        );
        const status = await resolveClientAuthStatus();
        if (!status.ready) {
            return false;
        }
        if (status.authenticated === undefined) {
            return false;
        }
        return !status.authenticated;
    } catch {
        // If auth status cannot be resolved, avoid destructive fallback to default DB.
        return false;
    }
}

export function useWorkspaceManager() {
    const { data: sessionData } = useSessionContext();
    
    /**
     * Compute active workspace ID from session data
     */
    const activeWorkspaceId = computed(() => {
        const session = sessionData.value?.session;
        if (!session || !session.authenticated) {
            return null;
        }
        return session.workspace?.id ?? null;
    });

    /**
     * Watch for workspace changes and update active DB
     * This is the SINGLE place where setActiveWorkspaceDb() should be called
     * based on session changes.
     */
    watch(
        activeWorkspaceId,
        async (newId, oldId) => {
            // Skip if no actual change
            if (newId === oldId) return;

            const token = ++workspaceChangeToken;

            if (newId) {
                setActiveWorkspaceDb(newId);
                console.log('[workspace-manager] Workspace activated:', newId);
                return;
            }

            const session = sessionData.value?.session;
            if (session?.authenticated === false) {
                if (token !== workspaceChangeToken) return;
                setActiveWorkspaceDb(null);
                console.log('[workspace-manager] Workspace cleared');
                return;
            }

            const shouldClear = await shouldClearWorkspaceForNullSession(oldId ?? null);
            if (token !== workspaceChangeToken) return;

            if (!shouldClear) {
                if (import.meta.dev) {
                    console.debug(
                        '[workspace-manager] Ignoring transient null workspace while auth status is unsettled',
                        { oldWorkspaceId: oldId ?? null }
                    );
                }
                return;
            }

            setActiveWorkspaceDb(null);
            console.log('[workspace-manager] Workspace cleared');
        },
        { immediate: true }
    );

    return {
        activeWorkspaceId,
    };
}
