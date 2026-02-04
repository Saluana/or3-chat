/**
 * @module server/auth/store/impls/convex-auth-workspace-store.ts
 *
 * Purpose:
 * Convex implementation of AuthWorkspaceStore. This is a TEMPORARY location.
 * This implementation will be moved to the or3-provider-convex package in Phase 3.
 *
 * Current Status:
 * - Lives in core to maintain existing behavior during refactoring
 * - Will be deleted from core once provider package is created
 *
 * DO NOT import this file directly. Use getAuthWorkspaceStore('convex') instead.
 */
import type { AuthWorkspaceStore } from '../types';
import type { WorkspaceRole } from '~~/app/core/hooks/hook-types';

/**
 * Convex-backed AuthWorkspaceStore implementation.
 *
 * Implementation:
 * - Uses Convex HTTP client for server-side queries/mutations
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
        const { getConvexClient } = await import('../../../utils/convex-client');
        const { api } = await import('~~/convex/_generated/api');
        const convex = getConvexClient();

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
        const { getConvexClient } = await import('../../../utils/convex-client');
        const { api } = await import('~~/convex/_generated/api');
        const convex = getConvexClient();

        // For Convex, we need the provider and provider_user_id
        // This is a limitation of the current API - we'll need to pass this through
        // For now, we'll use a workaround: query with the userId
        // This assumes userId is the provider_user_id (which it is in current impl)
        
        // Get or create workspace via ensure
        const workspaceInfo = await convex.mutation(api.workspaces.ensure, {
            provider: 'clerk', // TODO: Pass provider through properly
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
        const { getConvexClient } = await import('../../../utils/convex-client');
        const { api } = await import('~~/convex/_generated/api');
        const convex = getConvexClient();

        const resolved = await convex.query(api.workspaces.resolveSession, {
            provider: 'clerk', // TODO: Pass provider through properly
            provider_user_id: input.userId,
        });

        if (!resolved || resolved.id !== input.workspaceId) {
            return null;
        }

        return resolved.role as WorkspaceRole;
    }

    async listUserWorkspaces(
        userId: string
    ): Promise<Array<{ id: string; name: string; role: WorkspaceRole }>> {
        const { getConvexClient } = await import('../../../utils/convex-client');
        const { api } = await import('~~/convex/_generated/api');
        const convex = getConvexClient();

        // This is a limitation - Convex doesn't have a direct listUserWorkspaces query
        // For now, return empty array - this will be implemented properly in the provider package
        // The primary use case (session resolution) doesn't need this method
        return [];
    }
}

/**
 * Factory function for creating Convex AuthWorkspaceStore instances.
 */
export function createConvexAuthWorkspaceStore(): AuthWorkspaceStore {
    return new ConvexAuthWorkspaceStore();
}
