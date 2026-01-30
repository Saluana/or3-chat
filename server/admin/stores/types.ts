export interface WorkspaceMemberInfo {
    userId: string;
    email?: string;
    role: 'owner' | 'editor' | 'viewer';
}

export interface WorkspaceSummary {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    deleted: boolean;
    deletedAt?: number;
    ownerUserId?: string;
    ownerEmail?: string;
    memberCount: number;
}

export interface WorkspaceAccessStore {
    listMembers(input: { workspaceId: string }): Promise<WorkspaceMemberInfo[]>;
    upsertMember(input: {
        workspaceId: string;
        emailOrProviderId: string;
        role: 'owner' | 'editor' | 'viewer';
        provider?: string;
    }): Promise<void>;
    setMemberRole(input: {
        workspaceId: string;
        userId: string;
        role: 'owner' | 'editor' | 'viewer';
    }): Promise<void>;
    removeMember(input: { workspaceId: string; userId: string }): Promise<void>;

    // New methods for admin dashboard
    listWorkspaces(input: {
        search?: string;
        includeDeleted?: boolean;
        page: number;
        perPage: number;
    }): Promise<{ items: WorkspaceSummary[]; total: number }>;
    getWorkspace(input: { workspaceId: string }): Promise<WorkspaceSummary | null>;
    createWorkspace(input: {
        name: string;
        description?: string;
        ownerUserId: string;
    }): Promise<{ workspaceId: string }>;
    softDeleteWorkspace(input: { workspaceId: string; deletedAt: number }): Promise<void>;
    restoreWorkspace(input: { workspaceId: string }): Promise<void>;
    searchUsers(input: {
        query: string;
        limit?: number;
    }): Promise<Array<{ userId: string; email?: string; displayName?: string }>>;
}

export interface WorkspaceSettingsStore {
    get(workspaceId: string, key: string): Promise<string | null>;
    set(workspaceId: string, key: string, value: string): Promise<void>;
}

export interface AdminUserInfo {
    userId: string;
    email?: string;
    displayName?: string;
    createdAt: number;
}

export interface AdminUserStore {
    /**
     * List all users with deployment admin access.
     */
    listAdmins(): Promise<AdminUserInfo[]>;
    
    /**
     * Grant admin access to a user.
     */
    grantAdmin(input: { userId: string; createdByUserId?: string }): Promise<void>;
    
    /**
     * Revoke admin access from a user (hard delete).
     */
    revokeAdmin(input: { userId: string }): Promise<void>;
    
    /**
     * Check if a user has deployment admin access.
     */
    isAdmin(input: { userId: string }): Promise<boolean>;
    
    /**
     * Search users by email or display name.
     */
    searchUsers(input: {
        query: string;
        limit?: number;
    }): Promise<Array<{ userId: string; email?: string; displayName?: string }>>;
}

/**
 * Admin store capabilities interface.
 * Indicates which admin features are supported by the current sync provider.
 */
export interface AdminStoreCapabilities {
    /** Whether the provider supports server-side admin operations (super admin without user session) */
    supportsServerSideAdmin: boolean;
    /** Whether the provider supports user search */
    supportsUserSearch: boolean;
    /** Whether the provider supports listing all workspaces */
    supportsWorkspaceList: boolean;
    /** Whether the provider supports workspace management (create, delete, restore) */
    supportsWorkspaceManagement: boolean;
    /** Whether the provider supports deployment admin grants */
    supportsDeploymentAdminGrants: boolean;
}
