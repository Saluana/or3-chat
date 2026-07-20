export async function shouldClearWorkspaceForNullSession(
    oldWorkspaceId: string | null
): Promise<boolean> {
    if (!oldWorkspaceId) return true;
    if (!import.meta.client) return true;

    try {
        const { confirmClientSignedOut } = await import(
            '~/composables/auth/confirmClientSignedOut'
        );
        return await confirmClientSignedOut();
    } catch {
        // If auth status cannot be resolved, avoid destructive fallback to default DB.
        return false;
    }
}
