import type { H3Event } from 'h3';
import { createError } from 'h3';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import type {
    WorkspaceAccessStore,
    WorkspaceSettingsStore,
    AdminUserStore,
    WorkspaceSummary,
    AdminUserInfo,
} from '../types';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../../utils/sync/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';

/**
 * Validate and convert a workspace ID string to Convex Id type.
 * Throws if the ID format is invalid.
 */
function validateWorkspaceId(id: string): Id<'workspaces'> {
    if (!id || typeof id !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid workspace ID: must be a non-empty string',
        });
    }
    // Convex IDs have format "tableName:identifier"
    if (!id.startsWith('workspaces:')) {
        throw createError({
            statusCode: 400,
            statusMessage: `Invalid workspace ID format: ${id}`,
        });
    }
    return id as Id<'workspaces'>;
}

/**
 * Validate and convert a user ID string to Convex Id type.
 * Throws if the ID format is invalid.
 */
function validateUserId(id: string): Id<'users'> {
    if (!id || typeof id !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid user ID: must be a non-empty string',
        });
    }
    if (!id.startsWith('users:')) {
        throw createError({
            statusCode: 400,
            statusMessage: `Invalid user ID format: ${id}`,
        });
    }
    return id as Id<'users'>;
}

async function getConvexClientWithAuth(event: H3Event) {
    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing provider token',
        });
    }
    return getConvexGatewayClient(event, token);
}

export function createConvexWorkspaceAccessStore(
    event: H3Event
): WorkspaceAccessStore {
    return {
        async listMembers({ workspaceId }) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listWorkspaceMembers, {
                workspace_id: validateWorkspaceId(workspaceId),
            });
        },
        async upsertMember({ workspaceId, emailOrProviderId, role, provider }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.upsertWorkspaceMember, {
                workspace_id: validateWorkspaceId(workspaceId),
                email_or_provider_id: emailOrProviderId,
                role,
                provider,
            });
        },
        async setMemberRole({ workspaceId, userId, role }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.setWorkspaceMemberRole, {
                workspace_id: validateWorkspaceId(workspaceId),
                user_id: userId,
                role,
            });
        },
        async removeMember({ workspaceId, userId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.removeWorkspaceMember, {
                workspace_id: validateWorkspaceId(workspaceId),
                user_id: userId,
            });
        },
        async listWorkspaces({ search, includeDeleted, page, perPage }) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listWorkspaces, {
                search,
                include_deleted: includeDeleted,
                page,
                per_page: perPage,
            });
        },
        async getWorkspace({ workspaceId }) {
            const client = await getConvexClientWithAuth(event);
            const result = await client.query(api.admin.getWorkspace, {
                workspace_id: validateWorkspaceId(workspaceId),
            });
            return result as WorkspaceSummary | null;
        },
        async createWorkspace({ name, description, ownerUserId }) {
            const client = await getConvexClientWithAuth(event);
            const result = await client.mutation(api.admin.createWorkspace, {
                name,
                description,
                owner_user_id: validateUserId(ownerUserId),
            });
            return { workspaceId: result.workspace_id };
        },
        async softDeleteWorkspace({ workspaceId, deletedAt }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.softDeleteWorkspace, {
                workspace_id: validateWorkspaceId(workspaceId),
                deleted_at: deletedAt,
            });
        },
        async restoreWorkspace({ workspaceId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.restoreWorkspace, {
                workspace_id: validateWorkspaceId(workspaceId),
            });
        },
        async searchUsers({ query, limit }) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.searchUsers, {
                query,
                limit,
            });
        },
    };
}

export function createConvexWorkspaceSettingsStore(
    event: H3Event
): WorkspaceSettingsStore {
    return {
        async get(workspaceId, key) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.getWorkspaceSetting, {
                workspace_id: validateWorkspaceId(workspaceId),
                key,
            });
        },
        async set(workspaceId, key, value) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.setWorkspaceSetting, {
                workspace_id: validateWorkspaceId(workspaceId),
                key,
                value,
            });
        },
    };
}

export function createConvexAdminUserStore(event: H3Event): AdminUserStore {
    return {
        async listAdmins(): Promise<AdminUserInfo[]> {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listAdmins, {});
        },
        async grantAdmin({ userId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.grantAdmin, {
                user_id: validateUserId(userId),
            });
        },
        async revokeAdmin({ userId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.revokeAdmin, {
                user_id: validateUserId(userId),
            });
        },
        async isAdmin({ userId }) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.isAdmin, {
                user_id: validateUserId(userId),
            });
        },
        async searchUsers({ query, limit }) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.searchUsers, {
                query,
                limit,
            });
        },
    };
}
