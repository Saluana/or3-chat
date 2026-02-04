import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { AuthWorkspaceStore } from '~~/server/auth/store/types';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getProviderToken, getConvexGatewayClient } from '../utils/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

export function createConvexAuthWorkspaceStore(event: H3Event): AuthWorkspaceStore {
    return {
        async getOrCreateUser(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            await client.mutation(api.workspaces.ensure, {
                provider: input.provider,
                provider_user_id: input.providerUserId,
                email: input.email,
                name: input.displayName,
            });
            return { userId: input.providerUserId };
        },

        async getOrCreateDefaultWorkspace(userId) {
            const config = useRuntimeConfig(event);
            const provider = config.auth.provider;
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            const result = await client.mutation(api.workspaces.ensure, {
                provider,
                provider_user_id: userId,
            });
            return { workspaceId: result.id as string };
        },

        async getWorkspaceRole(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            const list = await client.query(api.workspaces.listMyWorkspaces, {});
            const match = list.find((workspace) => workspace._id === input.workspaceId);
            return (match?.role as 'owner' | 'editor' | 'viewer') ?? null;
        },

        async listUserWorkspaces(_userId) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            const list = await client.query(api.workspaces.listMyWorkspaces, {});
            return list.map((workspace) => ({
                id: workspace._id as Id<'workspaces'> as string,
                name: workspace.name,
                description: workspace.description ?? null,
                role: workspace.role as 'owner' | 'editor' | 'viewer',
            }));
        },

        async getWorkspace(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            const list = await client.query(api.workspaces.listMyWorkspaces, {});
            const match = list.find((workspace) => workspace._id === input.workspaceId);
            return match
                ? {
                      id: match._id as string,
                      name: match.name,
                      description: match.description ?? null,
                  }
                : null;
        },

        async createWorkspace(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            const workspaceId = await client.mutation(api.workspaces.create, {
                name: input.name,
                description: input.description ?? undefined,
            });
            return { id: workspaceId as string };
        },

        async updateWorkspace(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            await client.mutation(api.workspaces.update, {
                workspace_id: input.id as Id<'workspaces'>,
                name: input.name,
                description: input.description ?? undefined,
            });
        },

        async removeWorkspace(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            await client.mutation(api.workspaces.remove, {
                workspace_id: input.id as Id<'workspaces'>,
            });
        },

        async setActiveWorkspace(input) {
            const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
            if (!token) {
                throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
            }
            const client = getConvexGatewayClient(event, token);
            await client.mutation(api.workspaces.setActive, {
                workspace_id: input.id as Id<'workspaces'>,
            });
        },
    };
}
