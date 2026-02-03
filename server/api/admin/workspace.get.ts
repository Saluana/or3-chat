/**
 * @module server/api/admin/workspace.get
 *
 * Purpose:
 * Aggregates workspace details, members, and settings for the admin dashboard.
 *
 * Responsibilities:
 * - Resolves target workspace (Super Admin override vs Session default)
 * - Fetches members list, plugin states, and guest access settings
 */
import { defineEventHandler, createError, getQuery } from 'h3';
import { requireAdminApi, getAdminContext } from '../../admin/api';
import {
    getWorkspaceAccessStore,
    getWorkspaceSettingsStore,
} from '../../admin/stores/registry';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { isSuperAdmin } from '../../admin/context';

/**
 * GET /api/admin/workspace
 *
 * Purpose:
 * Provides the initial data payload for the workspace management view.
 *
 * Behavior:
 * 1. Checks permissions.
 * 2. Determines target `workspaceId`:
 *    - If Super Admin + `workspaceId` query param -> use that.
 *    - Otherwise -> use `session.workspace.id`.
 * 3. Fetches members, plugins, and settings in parallel-ish fashion.
 *
 * Errors:
 * - 404: Workspace not found (if super admin queries invalid ID)
 * - 400: Workspace not resolved (if no session workspace and not super admin explicit)
 *
 * Returns:
 * - `workspace`: Basic info `{ id, name }`
 * - `role`: Effective role ('owner' for super admin)
 * - `members`: List of members
 * - `enabledPlugins`: List of active plugin IDs
 * - `guestAccessEnabled`: Boolean flag
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);
    
    // Get admin context to check if super admin
    const adminContext = getAdminContext(event);
    const isSuper = adminContext ? isSuperAdmin(adminContext) : false;
    
    // Check for explicit workspaceId parameter (super admins can access any workspace)
    const query = getQuery(event);
    const explicitWorkspaceId = query.workspaceId as string | undefined;
    
    let workspaceId: string;
    let workspaceName: string;
    
    if (isSuper && explicitWorkspaceId) {
        // Super admin with explicit workspace ID - fetch that workspace
        workspaceId = explicitWorkspaceId;
        // Fetch workspace name from store
        const accessStore = getWorkspaceAccessStore(event);
        const workspace = await accessStore.getWorkspace({ workspaceId });
        if (!workspace) {
            throw createError({
                statusCode: 404,
                statusMessage: 'Workspace not found',
            });
        }
        workspaceName = workspace.name;
    } else if (session.workspace?.id) {
        // Regular workspace admin - use their assigned workspace
        workspaceId = session.workspace.id;
        workspaceName = session.workspace.name;
    } else {
        // No workspace context available
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace not resolved',
        });
    }

    const accessStore = getWorkspaceAccessStore(event);
    const settingsStore = getWorkspaceSettingsStore(event);

    const members = await accessStore.listMembers({
        workspaceId,
    });
    const enabledPlugins = await getEnabledPlugins(
        settingsStore,
        workspaceId
    );
    const guestAccessValue = await settingsStore.get(
        workspaceId,
        'admin.guest_access.enabled'
    );

    return {
        workspace: { id: workspaceId, name: workspaceName },
        role: isSuper ? 'owner' : session.role, // Super admins act as owners
        members,
        enabledPlugins,
        guestAccessEnabled: guestAccessValue === 'true',
    };
});
