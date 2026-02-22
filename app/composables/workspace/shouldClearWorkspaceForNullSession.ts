export async function shouldClearWorkspaceForNullSession(
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
        // If auth status cannot be resolved, avoid destructive fallback to default DB.
        return false;
    }
}
