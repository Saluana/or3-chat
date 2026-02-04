/**
 * @module server/auth/store/types.ts
 *
 * Purpose:
 * Defines the abstract persistence layer for SSR Auth. This interface decouples
 * session resolution from specific backend technologies (e.g., Convex, SQL, etc.).
 *
 * Current Status:
 * **Internal / Under Construction**.
 * Session resolution currently uses direct Convex imports for expediency.
 * This interface outlines the target architecture for multi-backend support.
 */
import type { WorkspaceRole } from '~/core/hooks/hook-types';

/**
 * Purpose:
 * Interface for auth-related workspace and user persistence.
 *
 * Responsibilities:
 * - Map external provider identities to internal persistent IDs.
 * - Manage workspace assignments and role resolution.
 * - Abstract multi-tenant scoping logic.
 */
export interface AuthWorkspaceStore {
    /**
     * Purpose:
     * Resolves an internal user ID from an external provider's identity.
     * Must be idempotent; creates a new user if one does not exist.
     *
     * @returns The internal unique ID for the user.
     */
    getOrCreateUser(input: {
        provider: string;
        providerUserId: string;
        email?: string;
        displayName?: string;
    }): Promise<{ userId: string }>;

    /**
     * Purpose:
     * Ensures every user has at least one workspace upon initial login.
     *
     * @returns The internal unique ID for the workspace.
     */
    getOrCreateDefaultWorkspace(
        userId: string
    ): Promise<{ workspaceId: string }>;

    /**
     * Purpose:
     * Evaluates the hierarchical role of a user within a specific workspace.
     *
     * @returns The assigned `WorkspaceRole`, or `null` if the user has no access.
     */
    getWorkspaceRole(input: {
        userId: string;
        workspaceId: string;
    }): Promise<WorkspaceRole | null>;

    /**
     * Purpose:
     * Retrieves all workspaces where the user holds an active membership.
     */
    listUserWorkspaces(
        userId: string
    ): Promise<Array<{ id: string; name: string; role: WorkspaceRole; description?: string | null }>>;

    /**
     * Purpose:
     * Resolve a workspace by ID for session hydration.
     */
    getWorkspace(input: {
        workspaceId: string;
    }): Promise<{ id: string; name: string; description?: string | null } | null>;

    /**
     * Purpose:
     * Create a new workspace for a user.
     */
    createWorkspace(input: {
        userId: string;
        name: string;
        description?: string | null;
    }): Promise<{ id: string }>;

    /**
     * Purpose:
     * Update workspace metadata.
     */
    updateWorkspace(input: {
        userId: string;
        id: string;
        name: string;
        description?: string | null;
    }): Promise<void>;

    /**
     * Purpose:
     * Remove (or archive) a workspace.
     */
    removeWorkspace(input: { userId: string; id: string }): Promise<void>;

    /**
     * Purpose:
     * Set the active workspace for the user session.
     */
    setActiveWorkspace(input: { userId: string; id: string }): Promise<void>;
}

/**
 * @example
 * ```ts
 * class MockStore implements AuthWorkspaceStore {
 *   async getOrCreateUser({ provider, providerUserId }) {
 *     return { userId: `${provider}:${providerUserId}` };
 *   }
 *   async getOrCreateDefaultWorkspace(userId) {
 *     return { workspaceId: 'default' };
 *   }
 *   async getWorkspaceRole() {
 *     return 'owner';
 *   }
 *   async listUserWorkspaces() {
 *     return [{ id: 'default', name: 'My Workspace', role: 'owner' }];
 *   }
 * }
 * ```
 */
