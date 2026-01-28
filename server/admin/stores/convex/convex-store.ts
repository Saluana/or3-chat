import type { H3Event } from 'h3';
import { createError } from 'h3';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import type { WorkspaceAccessStore, WorkspaceSettingsStore } from '../types';
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
