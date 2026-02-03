/**
 * @module server/admin/stores/types.ts
 *
 * Purpose:
 * Defines the abstract contracts and domain entities for the admin data layer.
 * These interfaces ensure that the admin dashboard can operate independently
 * of the underlying sync provider (e.g., Convex, Local).
 *
 * Responsibilities:
 * - Definition of workspace and user management interfaces.
 * - Definition of application settings storage contracts.
 * - Definition of provider capability schemas.
 */
export interface WorkspaceMemberInfo {
    userId: string;
    email?: string;
    role: 'owner' | 'editor' | 'viewer';
}

/**
 * Summary information for a workspace, used in list views and management.
 */
export interface WorkspaceSummary {
    /** Unique workspace identifier */
    id: string;
    /** Display name of the workspace */
    name: string;
    /** Optional workspace description */
    description?: string;
    /** Epoch timestamp of creation */
    createdAt: number;
    /** Whether the workspace is currently soft-deleted */
    deleted: boolean;
    /** Epoch timestamp of deletion, if applicable */
    deletedAt?: number;
    /** User ID of the primary owner */
    ownerUserId?: string;
    /** Email of the primary owner, if known */
    ownerEmail?: string;
    /** Total number of members in the workspace */
    memberCount: number;
}

/**
 * Interface for managing workspace membership and access control.
 *
 * Responsibilities:
 * - Listing, adding, and removing workspace members.
 * - Managing member roles (owner, editor, viewer).
 * - Listing and searching all workspaces across the deployment.
 * - Performing workspace lifecycle operations (create, delete, restore).
 */
export interface WorkspaceAccessStore {
    /** Retrieves all members belonging to a workspace. */
    listMembers(input: { workspaceId: string }): Promise<WorkspaceMemberInfo[]>;
    /** Adds or updates a member's access to a workspace. */
    upsertMember(input: {
        workspaceId: string;
        emailOrProviderId: string;
        role: 'owner' | 'editor' | 'viewer';
        provider?: string;
    }): Promise<void>;
    /** Changes the role of an existing workspace member. */
    setMemberRole(input: {
        workspaceId: string;
        userId: string;
        role: 'owner' | 'editor' | 'viewer';
    }): Promise<void>;
    /** Permanently removes a member's access from a workspace. */
    removeMember(input: { workspaceId: string; userId: string }): Promise<void>;

    /**
     * Lists workspaces across the entire application with pagination.
     * Used exclusively by the super admin dashboard.
     */
    listWorkspaces(input: {
        search?: string;
        includeDeleted?: boolean;
        page: number;
        perPage: number;
    }): Promise<{ items: WorkspaceSummary[]; total: number }>;
    /** Retrieves a single workspace summary by its ID. */
    getWorkspace(input: { workspaceId: string }): Promise<WorkspaceSummary | null>;
    /** Creates a new workspace and assigns an initial owner. */
    createWorkspace(input: {
        name: string;
        description?: string;
        ownerUserId: string;
    }): Promise<{ workspaceId: string }>;
    /** Soft-deletes a workspace, making it unavailable to users but recoverable by admins. */
    softDeleteWorkspace(input: { workspaceId: string; deletedAt: number }): Promise<void>;
    /** Reverses a soft-deletion. */
    restoreWorkspace(input: { workspaceId: string }): Promise<void>;
    /** Searches for users across the entire system. */
    searchUsers(input: {
        query: string;
        limit?: number;
    }): Promise<Array<{ userId: string; email?: string; displayName?: string }>>;
}

/**
 * Interface for key-value settings specific to a workspace.
 * Primarily used for plugin configuration storage.
 */
export interface WorkspaceSettingsStore {
    /** Retrieves a setting value from the store. */
    get(workspaceId: string, key: string): Promise<string | null>;
    /** Persists a setting value to the store. */
    set(workspaceId: string, key: string, value: string): Promise<void>;
}

export interface AdminUserInfo {
    userId: string;
    email?: string;
    displayName?: string;
    createdAt: number;
}

/**
 * Interface for managing global deployment administrators (Super Admins).
 * These users have access to the Admin Dashboard and all system-wide operations.
 */
export interface AdminUserStore {
    /** Retrieves the list of all users with system-level administrator privileges. */
    listAdmins(): Promise<AdminUserInfo[]>;
    /** Promotes a standard user to a system-level administrator. */
    grantAdmin(input: { userId: string; createdByUserId?: string }): Promise<void>;
    /** Removes system-level administrator privileges from a user. */
    revokeAdmin(input: { userId: string }): Promise<void>;
    /** Checks if a specific user has system-level administrator access. */
    isAdmin(input: { userId: string }): Promise<boolean>;
    /** Searches for users across the deployment to identify potential admin candidates. */
    searchUsers(input: {
        query: string;
        limit?: number;
    }): Promise<Array<{ userId: string; email?: string; displayName?: string }>>;
}

/**
 * Admin store capabilities interface.
 * Indicates which admin features are natively supported by the current sync provider.
 *
 * Architecture:
 * This allows the UI to dynamically hide or disable management features
 * (like user search or workspace creation) if the current backend provider
 * does not support them.
 */
export interface AdminStoreCapabilities {
    /** Whether the provider supports server-side admin operations without an active user session. */
    supportsServerSideAdmin: boolean;
    /** Whether the provider supports global user search. */
    supportsUserSearch: boolean;
    /** Whether the provider supports listing all workspaces in the deployment. */
    supportsWorkspaceList: boolean;
    /** Whether the provider supports full workspace lifecycle management (create/delete). */
    supportsWorkspaceManagement: boolean;
    /** Whether the provider supports explicit administrator grants. */
    supportsDeploymentAdminGrants: boolean;
}
