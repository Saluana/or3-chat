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

/** Canonical identity for support inspection. Timestamps are epoch milliseconds. */
export interface CustomerSummary {
    userId: string;
    email?: string;
    displayName?: string;
    createdAt: number;
    /** Latest sync cursor write by this user: server contact, not a completed sync. */
    lastContactAt: number | null;
}

export interface SyncObservation {
    workspaceId: string;
    lastSuccessAt: number | null;
    lastSuccessOperation: string | null;
    lastFailureAt: number | null;
    lastFailureCode: string | null;
}

export interface CustomerPage {
    items: CustomerSummary[];
    /** Opaque continuation. Pages never claim a global total. */
    nextCursor: string | null;
}

export interface CustomerWorkspace {
    id: string;
    name: string;
    role: 'owner' | 'editor' | 'viewer';
    ownerUserId: string;
    createdAt: number;
    deleted: boolean;
    deletedAt?: number;
    memberCount: number;
    lastContactAt: number | null;
}

export interface StorageGenerationCandidatePage {
    items: Array<{ generation: import('../../storage/gateway/generation-lifecycle').ExternalStorageGenerationRecord;
        status: 'eligible' | 'blocked' | 'claimed' | 'deleted'; reason: string | null }>;
    complete: boolean; nextCursor: string | null; observedAt: number; workspaceId: string; retentionSeconds: number;
    estimatedLogicalBytes: number | null; scope: 'managed_generations_only'; legacyIncluded: false;
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
    /** Advisory canonical proof only; never returns deletion authority or scans physical storage. */
    getStorageGenerationCandidates?(input: { workspaceId: string; storageProviderId: 'fs' | 's3'; retentionSeconds: number; limit: number; cursor?: string }): Promise<StorageGenerationCandidatePage>;
    /** Gateway diagnostics, milliseconds. Missing methods mean no observation coverage. */
    recordSyncObservation?(input: { userId: string; workspaceId: string; operation: 'push' | 'pull' | 'snapshot' | 'cursor'; observedAt: number; outcome: 'success' | 'failure'; code?: string }): Promise<void>;
    getCustomerSyncObservations?(input: { userId: string }): Promise<SyncObservation[]>;
    /**
     * Optional support reads. Read-only and bounded (at most 50 rows); they never
     * provision users, workspaces or memberships. Absent methods mean unavailable.
     */
    listCustomers?(input: { query?: string; cursor?: string | null; limit: number }): Promise<CustomerPage>;
    /** Batch lookup by internal user IDs. Unknown IDs are omitted. */
    getCustomersByIds?(input: { userIds: string[] }): Promise<CustomerSummary[]>;
    /** Owned workspaces (including retained deleted ones) and memberships. */
    getCustomerWorkspaces?(input: { userId: string }): Promise<CustomerWorkspace[]>;
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
    /**
     * Optional provider-native compare-and-set. Candidate plugin setup uses
     * this when available so revision checks remain atomic across processes;
     * providers that only implement get/set are serialized within one host
     * process and must not claim multi-instance CAS semantics.
     */
    compareAndSet?(
        workspaceId: string,
        key: string,
        expectedValue: string | null,
        nextValue: string
    ): Promise<boolean>;
    /**
     * Optional access to values a provider historically kept in a
     * client-writable namespace (for example Convex `kv`, which workspace
     * editors could push through ordinary sync). Values here are untrusted:
     * the host migration policy decides what may be copied into the private
     * settings store, and security-authoritative keys are never copied.
     */
    getLegacy?(workspaceId: string, key: string): Promise<string | null>;
}

export interface AdminUserInfo {
    userId: string;
    email?: string;
    displayName?: string;
    createdAt: number;
}

/**
 * Interface for managing deployment-admin grants. Grants authorize admin.access;
 * super-admin routes still require the separately authenticated super-admin.
 */
export interface AdminUserStore {
    /** Retrieves users with deployment-admin grants. */
    listAdmins(): Promise<AdminUserInfo[]>;
    /** Grants deployment-admin access to a user. */
    grantAdmin(input: { userId: string; createdByUserId?: string }): Promise<void>;
    /** Removes a user's deployment-admin grant. */
    revokeAdmin(input: { userId: string }): Promise<void>;
    /** Checks whether the canonical user has a deployment-admin grant. */
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
