/**
 * Deployment admin checker abstraction.
 * 
 * This provides a provider-agnostic way to check if a user has deployment-wide
 * admin access. Different sync providers can implement this interface.
 */
import type { H3Event } from 'h3';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

export interface DeploymentAdminChecker {
    /**
     * Check if a user has deployment-wide admin access.
     * 
     * @param providerUserId - The provider's user ID (e.g., Clerk user ID)
     * @param provider - The auth provider ID
     * @returns true if user has deployment admin access
     */
    checkDeploymentAdmin(providerUserId: string, provider: string): Promise<boolean>;
}

let cachedChecker: DeploymentAdminChecker | null = null;
let cachedProviderId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Get the deployment admin checker for the current sync provider.
 */
export function getDeploymentAdminChecker(event?: H3Event): DeploymentAdminChecker {
    const config = useRuntimeConfig(event);
    const syncProviderId = config.sync?.provider || CONVEX_PROVIDER_ID;
    const now = Date.now();

    // Return cached checker if valid and provider hasn't changed
    if (cachedChecker && 
        cachedProviderId === syncProviderId && 
        now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedChecker;
    }

    // Create implementation based on provider
    const checker = createChecker(syncProviderId);
    cachedChecker = checker;
    cachedProviderId = syncProviderId;
    cacheTimestamp = now;

    return checker;
}

function createChecker(providerId: string): DeploymentAdminChecker {
    switch (providerId) {
        case CONVEX_PROVIDER_ID:
            return new ConvexDeploymentAdminChecker();
        default:
            // For unsupported providers, always return false
            // This means only super admin JWT auth will work
            return new NoOpDeploymentAdminChecker();
    }
}

/**
 * Convex implementation of DeploymentAdminChecker.
 */
class ConvexDeploymentAdminChecker implements DeploymentAdminChecker {
    async checkDeploymentAdmin(providerUserId: string, provider: string): Promise<boolean> {
        // Lazy import to avoid loading Convex when not needed
        const { getConvexClient } = await import('../utils/convex-client');
        const { api } = await import('~~/convex/_generated/api');

        try {
            const convex = getConvexClient();

            // Get the internal user ID from auth account
            const authAccount = await convex.query(api.users.getAuthAccountByProvider, {
                provider,
                provider_user_id: providerUserId,
            });

            if (!authAccount) {
                return false;
            }

            // Check if user has admin grant
            const isAdmin = await convex.query(api.admin.isAdmin, {
                user_id: authAccount.user_id,
            });

            return isAdmin;
        } catch {
            // If anything fails, assume not an admin
            return false;
        }
    }
}

/**
 * No-op implementation for providers that don't support deployment admin.
 */
class NoOpDeploymentAdminChecker implements DeploymentAdminChecker {
    async checkDeploymentAdmin(): Promise<boolean> {
        return false;
    }
}

/**
 * Clear the cached checker (useful for testing).
 */
export function clearDeploymentAdminCache(): void {
    cachedChecker = null;
    cachedProviderId = null;
    cacheTimestamp = 0;
}
