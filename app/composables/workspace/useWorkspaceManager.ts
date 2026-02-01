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

// Module-level flag shared across all instances (intentional for singleton behavior)
let workspaceChangeInProgress = false;

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
        (newId, oldId) => {
            // Skip if change already in progress
            if (workspaceChangeInProgress) return;
            
            // Skip if no actual change
            if (newId === oldId) return;

            workspaceChangeInProgress = true;
            try {
                // Set the active workspace DB
                setActiveWorkspaceDb(newId);
                
                if (newId) {
                    console.log('[workspace-manager] Workspace activated:', newId);
                } else {
                    console.log('[workspace-manager] Workspace cleared');
                }
            } finally {
                workspaceChangeInProgress = false;
            }
        },
        { immediate: true }
    );

    return {
        activeWorkspaceId,
    };
}
