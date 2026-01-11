/**
 * AuthWorkspaceStore interface.
 * Defines the contract for workspace/user persistence.
 * Default implementation will be backed by the SyncProvider backend (Convex).
 */
import type { WorkspaceRole } from '~/core/hooks/hook-types';

/**
 * Store interface for auth-related workspace and user persistence.
 * The actual implementation will use the selected SyncProvider backend.
 */
export interface AuthWorkspaceStore {
    /**
     * Get or create an internal user from provider identity.
     * Creates the user if it doesn't exist.
     */
    getOrCreateUser(input: {
        provider: string;
        providerUserId: string;
        email?: string;
        displayName?: string;
    }): Promise<{ userId: string }>;

    /**
     * Get or create a default workspace for a user.
     * Used on first login to ensure every user has a workspace.
     */
    getOrCreateDefaultWorkspace(
        userId: string
    ): Promise<{ workspaceId: string }>;

    /**
     * Get the role of a user in a workspace.
     * Returns null if the user is not a member.
     */
    getWorkspaceRole(input: {
        userId: string;
        workspaceId: string;
    }): Promise<WorkspaceRole | null>;

    /**
     * List all workspaces for a user.
     */
    listUserWorkspaces(
        userId: string
    ): Promise<Array<{ id: string; name: string; role: WorkspaceRole }>>;
}
