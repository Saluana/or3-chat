import type { Ref } from 'vue';
import type { useSessionContext } from '~/composables/auth/useSessionContext';

type SessionContextLike = ReturnType<typeof useSessionContext>;

async function shouldClearWorkspaceForNullSession(
    oldWorkspaceId: string | null
): Promise<boolean> {
    if (!oldWorkspaceId) return true;
    if (!import.meta.client) return true;

    try {
        const { resolveClientAuthStatus } = await import(
            '~/composables/auth/useClientAuthStatus.client'
        );
        const status = await resolveClientAuthStatus();
        if (!status.ready) return false;
        if (status.authenticated === undefined) return false;
        return !status.authenticated;
    } catch {
        return false;
    }
}

export function useWorkspaceManagerSession(
    sessionContext: SessionContextLike,
    authSessionStorageKey = 'or3:auth-session-changed'
) {
    async function refreshSessionUntilWorkspace(
        workspaceId: string
    ): Promise<boolean> {
        const delaysMs = [0, 100, 200, 400, 800];
        for (const delay of delaysMs) {
            if (delay) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            await sessionContext.refresh();
            const current =
                sessionContext.data.value?.session?.workspace?.id ?? null;
            if (current === workspaceId) return true;
        }
        return false;
    }

    async function refreshSessionAfterWorkspaceRemoval(
        removedWorkspaceId: string
    ): Promise<string | null> {
        const delaysMs = [0, 100, 200, 400, 800];
        let latestWorkspaceId: string | null = null;

        for (const delay of delaysMs) {
            if (delay) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            await sessionContext.refresh();
            latestWorkspaceId =
                sessionContext.data.value?.session?.workspace?.id ?? null;
            if (latestWorkspaceId !== removedWorkspaceId) {
                return latestWorkspaceId;
            }
        }

        return latestWorkspaceId;
    }

    function notifyOtherTabsAuthSessionChanged(): void {
        try {
            localStorage.setItem(authSessionStorageKey, String(Date.now()));
        } catch {
            // best effort
        }
    }

    return {
        refreshSessionUntilWorkspace,
        refreshSessionAfterWorkspaceRemoval,
        notifyOtherTabsAuthSessionChanged,
        shouldClearWorkspaceForNullSession,
    };
}
