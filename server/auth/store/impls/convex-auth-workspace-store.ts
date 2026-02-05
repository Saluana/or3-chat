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
import { ConvexHttpClient } from 'convex/browser';
import { useRuntimeConfig } from '#imports';

/**
 * Get an admin-authenticated Convex client for server-to-server calls.
 * Uses the admin key to bypass JWT validation since these are trusted server operations.
 */
function getAdminConvexClient(providerUserId: string): ConvexHttpClient {
    const config = useRuntimeConfig();
    const url = config.sync?.convexUrl;
    const adminKey = config.sync?.convexAdminKey;

    if (!url) {
        throw new Error('Convex URL not configured');
    }
    if (!adminKey) {
        throw new Error('Convex admin key not configured - required for server-side auth operations');
    }

    const client = new ConvexHttpClient(url as string);
    
    // Use admin auth to authenticate as the provider user
    // This allows the Convex mutations to verify identity.subject matches the request
    client.setAdminAuth(adminKey as string, {
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
    ): Promise<Array<{ id: string; name: string; role: WorkspaceRole }>> {
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
