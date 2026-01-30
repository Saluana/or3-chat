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
                workspace_id: workspaceId as Id<'workspaces'>,
            });
        },
        async upsertMember({ workspaceId, emailOrProviderId, role, provider }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.upsertWorkspaceMember, {
                workspace_id: workspaceId as Id<'workspaces'>,
                email_or_provider_id: emailOrProviderId,
                role,
                provider,
            });
        },
        async setMemberRole({ workspaceId, userId, role }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.setWorkspaceMemberRole, {
                workspace_id: workspaceId as Id<'workspaces'>,
                user_id: userId,
                role,
            });
        },
        async removeMember({ workspaceId, userId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.removeWorkspaceMember, {
                workspace_id: workspaceId as Id<'workspaces'>,
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
                workspace_id: workspaceId as Id<'workspaces'>,
            });
            return result as WorkspaceSummary | null;
        },
        async createWorkspace({ name, description, ownerUserId }) {
            const client = await getConvexClientWithAuth(event);
            const result = await client.mutation(api.admin.createWorkspace, {
                name,
                description,
                owner_user_id: ownerUserId as Id<'users'>,
            });
            return { workspaceId: result.workspace_id };
        },
        async softDeleteWorkspace({ workspaceId, deletedAt }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.softDeleteWorkspace, {
                workspace_id: workspaceId as Id<'workspaces'>,
                deleted_at: deletedAt,
            });
        },
        async restoreWorkspace({ workspaceId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.restoreWorkspace, {
                workspace_id: workspaceId as Id<'workspaces'>,
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
                workspace_id: workspaceId as Id<'workspaces'>,
                key,
            });
        },
        async set(workspaceId, key, value) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.setWorkspaceSetting, {
                workspace_id: workspaceId as Id<'workspaces'>,
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
                user_id: userId as Id<'users'>,
            });
        },
        async revokeAdmin({ userId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.revokeAdmin, {
                user_id: userId as Id<'users'>,
            });
        },
        async isAdmin({ userId }) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.isAdmin, {
                user_id: userId as Id<'users'>,
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
