/**
 * @module server/auth/store/impls/convex-auth-workspace-store.ts
 *
 * Purpose:
 * Convex implementation of AuthWorkspaceStore.
 *
 * DO NOT import this file directly in core. Use getAuthWorkspaceStore('convex')
 * after the Convex provider package registers the store.
 */
import type { AuthWorkspaceStore } from '~~/server/auth/store/types';
import type { WorkspaceRole } from '~~/app/core/hooks/hook-types';
import type { Id } from '~~/convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
import { useRuntimeConfig } from '#imports';

/**
 * Get an admin-authenticated Convex client for server-to-server calls.
 * Uses the admin key to bypass JWT validation since these are trusted server operations.
 */
function getAdminConvexClient(providerUserId: string): ConvexHttpClient {
    const config = useRuntimeConfig();
    const { convexUrl: url, convexAdminKey: adminKey } = config.sync;

    if (!url) {
        throw new Error('Convex URL not configured');
    }
    if (!adminKey) {
        throw new Error('Convex admin key not configured - required for server-side auth operations');
    }

    const client = new ConvexHttpClient(url);

    // Use admin auth to authenticate as the provider user
    // This allows the Convex mutations to verify identity.subject matches the request
    client.setAdminAuth(adminKey, {
        subject: providerUserId,
        issuer: 'https://clerk.or3.ai', // Standard Clerk issuer format
        tokenIdentifier: `https://clerk.or3.ai|${providerUserId}`,
    });

    return client;
}

/**
 * Convex-backed AuthWorkspaceStore implementation.
 *
 * Implementation:
 * - Uses Convex HTTP client with admin auth for server-side queries/mutations
 * - Calls workspaces.resolveSession and workspaces.ensure
 * - Maps Convex workspace data to AuthWorkspaceStore interface
 */
export class ConvexAuthWorkspaceStore implements AuthWorkspaceStore {
    async getOrCreateUser(input: {
        provider: string;
        providerUserId: string;
        email?: string;
        displayName?: string;
    }): Promise<{ userId: string }> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(input.providerUserId);

        const resolved = await convex.query(api.workspaces.resolveSession, {
            provider: input.provider,
            provider_user_id: input.providerUserId,
        });

        if (resolved) {
            return { userId: input.providerUserId };
        }

        // User doesn't exist, create via ensure mutation
        await convex.mutation(api.workspaces.ensure, {
            provider: input.provider,
            provider_user_id: input.providerUserId,
            email: input.email,
            name: input.displayName,
        });

        return { userId: input.providerUserId };
    }

    async getOrCreateDefaultWorkspace(
        userId: string
    ): Promise<{ workspaceId: string; workspaceName: string }> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(userId);

        // Get or create workspace via ensure
        const workspaceInfo = await convex.mutation(api.workspaces.ensure, {
            provider: 'clerk',
            provider_user_id: userId,
            email: undefined,
            name: undefined,
        });

        return {
            workspaceId: workspaceInfo.id,
            workspaceName: workspaceInfo.name,
        };
    }

    async getWorkspaceRole(input: {
        userId: string;
        workspaceId: string;
    }): Promise<WorkspaceRole | null> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(input.userId);

        const resolved = await convex.query(api.workspaces.resolveSession, {
            provider: 'clerk',
            provider_user_id: input.userId,
        });

        if (!resolved || resolved.id !== input.workspaceId) {
            return null;
        }

        return resolved.role as WorkspaceRole;
    }

    async listUserWorkspaces(
        userId: string
    ): Promise<
        Array<{
            id: string;
            name: string;
            description?: string | null;
            role: WorkspaceRole;
            createdAt?: number;
            isActive?: boolean;
        }>
    > {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(userId);

        const workspaces = await convex.query(api.workspaces.listMyWorkspaces, {});
        const normalized = Array.isArray(workspaces)
            ? workspaces.filter(
                  (workspace): workspace is NonNullable<typeof workspace> =>
                      Boolean(workspace)
              )
            : [];

        return normalized.map((workspace) => ({
            id: workspace._id,
            name: workspace.name,
            description: workspace.description ?? null,
            role: workspace.role,
            createdAt: workspace.created_at,
            isActive: Boolean(workspace.is_active),
        }));
    }

    async createWorkspace(input: {
        userId: string;
        name: string;
        description?: string | null;
    }): Promise<{ workspaceId: string }> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(input.userId);

        const workspaceId = await convex.mutation(api.workspaces.create, {
            name: input.name,
            description: input.description ?? undefined,
        });

        return { workspaceId };
    }

    async updateWorkspace(input: {
        userId: string;
        workspaceId: string;
        name: string;
        description?: string | null;
    }): Promise<void> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(input.userId);

        await convex.mutation(api.workspaces.update, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
            name: input.name,
            description: input.description ?? undefined,
        });
    }

    async removeWorkspace(input: { userId: string; workspaceId: string }): Promise<void> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(input.userId);

        await convex.mutation(api.workspaces.remove, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
        });
    }

    async setActiveWorkspace(input: {
        userId: string;
        workspaceId: string;
    }): Promise<void> {
        const { api } = await import('~~/convex/_generated/api');
        const convex = getAdminConvexClient(input.userId);

        await convex.mutation(api.workspaces.setActive, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
        });
    }
}

/**
 * Factory function for creating Convex AuthWorkspaceStore instances.
 */
export function createConvexAuthWorkspaceStore(): AuthWorkspaceStore {
    return new ConvexAuthWorkspaceStore();
}
