/**
 * @module server/auth/deployment-admin.ts
 *
 * Purpose:
 * Provides an abstraction for verifying deployment-wide administrative privileges.
 * This is distinct from workspace-level permissions and is typically used
 * for system-level settings, global user management, and infrastructure access.
 *
 * Architecture:
 * - **Provider-Agnostic**: Specific verification logic is delegated to
 *   implementations of the `DeploymentAdminChecker` interface.
 * - **Sync-Linked**: The choice of checker depends on the configured sync provider
 *   (e.g., Convex), as global admin status is usually stored in the primary backend.
 * - **Cached**: Uses a short-lived internal cache (1 minute TTL) to minimize redundant
 *   backend queries for the same provider.
 */
import type { H3Event } from 'h3';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

/**
 * Purpose:
 * Contract for checking deployment-level admin status.
 */
export interface DeploymentAdminChecker {
    /**
     * Purpose:
     * Evaluates if a specific user identity has been granted deployment admin status.
     *
     * @param providerUserId - The external ID from the auth provider (Clerk ID).
     * @param provider - The ID of the auth provider issuing the identity.
     * @returns A promise resolving to `true` if the user is a deployment admin.
     */
    checkDeploymentAdmin(providerUserId: string, provider: string): Promise<boolean>;
}

export type DeploymentAdminCheckerFactory = () => DeploymentAdminChecker;

const registry = new Map<string, DeploymentAdminCheckerFactory>();

export function registerDeploymentAdminChecker(
    id: string,
    create: DeploymentAdminCheckerFactory
): void {
    registry.set(id, create);
}

function getRegistryChecker(providerId: string): DeploymentAdminChecker | null {
    return registry.get(providerId)?.() ?? null;
}

let cachedChecker: DeploymentAdminChecker | null = null;
let cachedProviderId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Purpose:
 * Factory method to retrieve the appropriate deployment admin checker
 * for the current server configuration.
 */
export function getDeploymentAdminChecker(event?: H3Event): DeploymentAdminChecker {
    const config = useRuntimeConfig(event);
    const syncProviderId = config.sync.provider || CONVEX_PROVIDER_ID;
    const now = Date.now();

    // Return cached checker if valid and provider hasn't changed
    if (
        cachedChecker &&
        cachedProviderId === syncProviderId &&
        now - cacheTimestamp < CACHE_TTL_MS
    ) {
        return cachedChecker;
    }

    const checker =
        getRegistryChecker(syncProviderId) ?? new NoOpDeploymentAdminChecker();
    cachedChecker = checker;
    cachedProviderId = syncProviderId;
    cacheTimestamp = now;

    return checker;
}

/**
 * Purpose:
 * Default "deny-all" implementation for providers without global admin logic.
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
