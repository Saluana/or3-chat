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
} from '~~/server/admin/stores/types';
import {
    getProviderToken,
    getConvexAdminGatewayClient,
    getConvexGatewayClient,
} from '../utils/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';
import { ADMIN_IDENTITY_ISSUER } from '~~/shared/cloud/admin-identity';
import { useRuntimeConfig } from '#imports';

type AdminContextShape = {
    principal?: { kind?: string; username?: string };
    session?: { providerUserId?: string };
};

function buildAdminIdentity(username: string) {
    const normalized = username.trim() || 'super_admin';
    return {
        subject: normalized,
        issuer: ADMIN_IDENTITY_ISSUER,
        name: normalized,
        preferredUsername: normalized,
    };
}

async function ensureSuperAdminDeploymentGrant(
    event: H3Event,
    client: ReturnType<typeof getConvexGatewayClient>
): Promise<void> {
    const adminContext = event.context.admin as AdminContextShape | undefined;
    const principal = adminContext?.principal;
    if (!principal || principal.kind !== 'super_admin') return;
    if (event.context.__or3_super_admin_grant_done) return;
    event.context.__or3_super_admin_grant_done = true;

    const adminUsername = principal.username;
    const providerUserId = adminContext.session?.providerUserId;
    if (!adminUsername || !providerUserId) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing session for super admin bridging',
        });
    }

    const config = useRuntimeConfig(event);
    const secret = config.admin.auth.jwtSecret;
    if (!secret) {
        throw createError({
            statusCode: 500,
            statusMessage: 'OR3_ADMIN_JWT_SECRET is required for super admin bridging',
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

function validateWorkspaceId(id: string): Id<'workspaces'> {
    if (!id || typeof id !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid workspace ID: must be a non-empty string',
        });
    }
    return id as Id<'workspaces'>;
}

function validateUserId(id: string): Id<'users'> {
    if (!id || typeof id !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid user ID: must be a non-empty string',
        });
    }
    return id as Id<'users'>;
}

async function getConvexClientWithAuth(event: H3Event) {
    const config = useRuntimeConfig(event);
    const adminContext = event.context.admin as AdminContextShape | undefined;
    const principal = adminContext?.principal;

    if (principal?.kind === 'super_admin') {
        const adminKey = config.sync.convexAdminKey.trim();
        if (adminKey) {
            const identity = buildAdminIdentity(principal.username || 'super_admin');
            return getConvexAdminGatewayClient(event, adminKey, identity);
        }
    }

    const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing authentication token',
        });
    }
    const client = getConvexGatewayClient(event, token);
    if (principal?.kind === 'super_admin' && adminContext?.session?.providerUserId) {
        await ensureSuperAdminDeploymentGrant(event, client);
    }
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
                user_id: validateUserId(userId),
                role,
            });
        },
        async removeMember({ workspaceId, userId }) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.removeWorkspaceMember, {
                workspace_id: validateWorkspaceId(workspaceId),
                user_id: validateUserId(userId),
            });
        },
    };
}

export function createConvexWorkspaceSettingsStore(
    event: H3Event
): WorkspaceSettingsStore {
    return {
        async listWorkspaces() {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listWorkspaces, {});
        },
        async getWorkspace(id: string) {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.getWorkspace, {
                workspace_id: validateWorkspaceId(id),
            });
        },
        async createWorkspace(input) {
            const client = await getConvexClientWithAuth(event);
            return await client.mutation(api.admin.createWorkspace, {
                name: input.name,
                owner_user_id: validateUserId(input.ownerUserId),
                description: input.description,
            });
        },
        async updateWorkspace(input) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.updateWorkspace, {
                workspace_id: validateWorkspaceId(input.workspaceId),
                name: input.name,
                description: input.description,
            });
        },
        async deleteWorkspace(id: string) {
            const client = await getConvexClientWithAuth(event);
            await client.mutation(api.admin.deleteWorkspace, {
                workspace_id: validateWorkspaceId(id),
            });
        },
        async getRecentWorkspaces() {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listRecentWorkspaces, {});
        },
    };
}

export function createConvexAdminUserStore(event: H3Event): AdminUserStore {
    return {
        async searchUsers(query: string): Promise<AdminUserInfo[]> {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.searchUsers, { query });
        },
        async listUsers(): Promise<AdminUserInfo[]> {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listUsers, {});
        },
        async listWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
            const client = await getConvexClientWithAuth(event);
            return await client.query(api.admin.listWorkspaceSummaries, {});
        },
    };
}
