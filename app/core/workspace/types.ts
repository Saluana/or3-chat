/**
 * @module app/core/workspace/types.ts
 *
 * Purpose:
 * Defines the client-side interface for workspace lifecycle operations. This
 * decouples workspace UI from specific backend implementations (Convex, SQLite, etc.).
 *
 * Architecture:
 * - WorkspaceApi is the contract that workspace UI depends on
 * - Implementations can be direct (SDK) or gateway-based (SSR endpoints)
 * - Gateway-first approach is recommended for simplicity and build decoupling
 *
 * Example Flow:
 * 1. User clicks "Create Workspace" in WorkspaceManager.vue
 * 2. Component calls `useWorkspaceApi().create({ name: '...' })`
 * 3. Implementation makes SSR endpoint call: POST /api/workspaces
 * 4. Server endpoint uses AuthWorkspaceStore adapter
 * 5. Response returns new workspace ID
 * 6. Component updates UI with new workspace
 */

/**
 * Purpose:
 * Workspace summary for listing.
 *
 * Fields:
 * - `id`: Unique workspace identifier
 * - `name`: Workspace display name
 * - `description`: Optional workspace description
 * - `role`: User's role in this workspace ('owner', 'admin', 'member')
 * - `createdAt`: Unix timestamp when workspace was created
 * - `isActive`: Whether this is the currently active workspace
 */
export interface WorkspaceSummary {
    id: string;
    name: string;
    description?: string | null;
    role: string;
    createdAt: number;
    isActive?: boolean;
}

/**
 * Purpose:
 * Request to create a new workspace.
 */
export interface CreateWorkspaceRequest {
    name: string;
    description?: string | null;
}

/**
 * Purpose:
 * Response from workspace creation.
 */
export interface CreateWorkspaceResponse {
    id: string;
}

/**
 * Purpose:
 * Request to update an existing workspace.
 */
export interface UpdateWorkspaceRequest {
    id: string;
    name: string;
    description?: string | null;
}

/**
 * Purpose:
 * Request to remove a workspace.
 */
export interface RemoveWorkspaceRequest {
    id: string;
}

/**
 * Purpose:
 * Request to set the active workspace.
 */
export interface SetActiveWorkspaceRequest {
    id: string;
}

/**
 * Purpose:
 * Client-side workspace lifecycle interface.
 *
 * Responsibilities:
 * - List user's workspaces with role information
 * - Create new workspaces
 * - Update workspace metadata
 * - Remove workspaces
 * - Set active workspace (for multi-workspace contexts)
 *
 * Constraints:
 * - Must respect authentication and authorization
 * - Operations must be idempotent where possible
 * - Must handle concurrent modifications gracefully
 */
export interface WorkspaceApi {
    /**
     * List all workspaces accessible to the current user.
     *
     * Behavior:
     * - Returns workspaces ordered by creation date (newest first)
     * - Includes user's role in each workspace
     * - Marks currently active workspace if applicable
     *
     * @returns Array of workspace summaries
     */
    list(): Promise<WorkspaceSummary[]>;

    /**
     * Create a new workspace.
     *
     * Behavior:
     * - Creates workspace with current user as owner
     * - Initializes workspace with default settings
     * - Optionally sets as active workspace
     *
     * @param input - Workspace creation request
     * @returns Created workspace ID
     */
    create(input: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse>;

    /**
     * Update workspace metadata.
     *
     * Behavior:
     * - Updates workspace name and/or description
     * - Requires appropriate permissions (owner/admin)
     * - Fails if user lacks permission
     *
     * @param input - Workspace update request
     */
    update(input: UpdateWorkspaceRequest): Promise<void>;

    /**
     * Remove a workspace.
     *
     * Behavior:
     * - Soft-deletes or hard-deletes workspace (implementation-specific)
     * - Requires owner permission
     * - May fail if workspace has dependent resources
     *
     * @param input - Workspace removal request
     */
    remove(input: RemoveWorkspaceRequest): Promise<void>;

    /**
     * Set the active workspace for the current session.
     *
     * Behavior:
     * - Updates session to use specified workspace
     * - Client should re-initialize workspace-scoped resources
     * - Server updates active workspace in session
     *
     * @param input - Active workspace request
     */
    setActive(input: SetActiveWorkspaceRequest): Promise<void>;
}
