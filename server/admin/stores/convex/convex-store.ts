import type { H3Event } from 'h3';
import { createError } from 'h3';
import { createHmac } from 'crypto';
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
import { useRuntimeConfig } from '#imports';

type AdminContextShape = {
    principal?: { kind?: string; username?: string };
    session?: { providerUserId?: string };
};

async function ensureSuperAdminDeploymentGrant(
    event: H3Event,
    client: ReturnType<typeof getConvexGatewayClient>
): Promise<void> {
    const adminContext = event.context.admin as AdminContextShape | undefined;
    if (adminContext?.principal?.kind !== 'super_admin') return;
    if (event.context.__or3_super_admin_grant_done) return;
    event.context.__or3_super_admin_grant_done = true;

    const adminUsername = adminContext.principal?.username;
    const providerUserId = adminContext.session?.providerUserId;
    if (!adminUsername || !providerUserId) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing Clerk session for super admin bridging',
        });
    }

    const config = useRuntimeConfig(event);
    const secret = config.admin?.auth?.jwtSecret;
    if (!secret) {
        throw createError({
            statusCode: 500,
            statusMessage:
                'OR3_ADMIN_JWT_SECRET is required for super admin bridging',
        });
    }

    const bridgeSignature = createHmac('sha256', secret)
        .update(`or3-admin-bridge:${providerUserId}:${adminUsername}`)
        .digest('hex');

    try {
        await client.mutation(api.admin.ensureDeploymentAdmin, {
            bridge_signature: bridgeSignature,
            admin_username: adminUsername,
        });
    } catch (error) {
        throw createError({
            statusCode: 403,
            statusMessage:
                'Super admin bridging failed. Ensure OR3_ADMIN_JWT_SECRET is set in the Convex environment.',
            data: {
                original: error instanceof Error ? error.message : String(error),
            },
        });
    }
}

/**
 * Validate and convert a workspace ID string to Convex Id type.
 * Throws if the ID is empty/invalid.
 */
function validateWorkspaceId(id: string): Id<'workspaces'> {
    if (!id || typeof id !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid workspace ID: must be a non-empty string',
        });
    }
    // Convex Ids are opaque strings; some deployments prefix with "workspaces:"
    return id as Id<'workspaces'>;
}

/**
 * Validate and convert a user ID string to Convex Id type.
 * Throws if the ID is empty/invalid.
 */
function validateUserId(id: string): Id<'users'> {
    if (!id || typeof id !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid user ID: must be a non-empty string',
        });
    }
    // Convex Ids are opaque strings; some deployments prefix with "users:"
    return id as Id<'users'>;
}

async function getConvexClientWithAuth(event: H3Event) {
    const config = useRuntimeConfig(event);
    const authProvider = config.auth.provider;
    
    // Check if Clerk is configured (Convex store requires Clerk JWT for server-to-server auth)
    if (authProvider !== 'clerk') {
        throw createError({
            statusCode: 501,
            statusMessage: `Convex-based admin dashboard requires Clerk auth. ` +
                `For local development without Clerk, use the memory provider. ` +
                `Current provider: ${authProvider || 'none'}`,
        });
    }
    
    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing Clerk authentication token',
        });
    }
    const client = getConvexGatewayClient(event, token);
    await ensureSuperAdminDeploymentGrant(event, client);
    return client;
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
        async upsertMember(input: {
            workspaceId: string;
            emailOrProviderId: string;
            role: 'owner' | 'editor' | 'viewer';
            provider?: string;
        }) {
            const { workspaceId, emailOrProviderId, role, provider } = input;
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
