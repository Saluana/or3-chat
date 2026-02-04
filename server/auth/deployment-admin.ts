/**
 * @module server/auth/deployment-admin.ts
 *
 * Purpose:
 * Provides an abstraction for verifying deployment-wide administrative privileges.
 * This is distinct from workspace-level permissions and is typically used
 * for system-level settings, global user management, and infrastructure access.
 *
 * Architecture:
 * - **Provider-Agnostic**: The specific verification logic is delegated to
 *   implementations of the `DeploymentAdminChecker` interface.
 * - **Sync-Linked**: The choice of checker depends on the configured sync provider
 *   (e.g., Convex), as global admin status is usually stored in the primary backend.
 * - **Cached**: Uses a short-lived internal cache (1 minute TTL) to minimize redundant
 *   backend queries for the same provider.
 */
import type { H3Event } from 'h3';
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

export interface DeploymentAdminCheckerRegistryItem {
    id: string;
    create: () => DeploymentAdminChecker;
}

const registry = new Map<string, DeploymentAdminCheckerRegistryItem>();

export function registerDeploymentAdminChecker(
    item: DeploymentAdminCheckerRegistryItem
): void {
    if (import.meta.dev && registry.has(item.id)) {
        console.warn(`[auth:deployment-admin] Replacing checker: ${item.id}`);
    }
    registry.set(item.id, item);
}

let cachedChecker: DeploymentAdminChecker | null = null;
let cachedProviderId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Purpose:
 * Factory method to retrieve the appropriate deployment admin checker
 * for the current server configuration.
 *
 * Behavior:
 * - Memoizes the checker instance for 1 minute or until the sync provider changes.
 *
 * @param event - Optional H3 event for context-aware config resolution.
 *
 * @example
 * ```ts
 * const checker = getDeploymentAdminChecker(event);
 * const isAdmin = await checker.checkDeploymentAdmin('user_123', 'clerk');
 * if (isAdmin) {
 *   // Grant super-admin capabilities
 * }
 * ```
 */
export function getDeploymentAdminChecker(event?: H3Event): DeploymentAdminChecker {
    const config = useRuntimeConfig(event);
    const syncProviderId = config.sync.provider;
    const now = Date.now();

    // Return cached checker if valid and provider hasn't changed
    if (cachedChecker && 
        cachedProviderId === syncProviderId && 
        now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedChecker;
    }

    // Create implementation based on provider
    const checker = resolveChecker(syncProviderId);
    cachedChecker = checker;
    cachedProviderId = syncProviderId;
    cacheTimestamp = now;

    return checker;
}

/**
 * Purpose:
 * Instantiates a checker implementation based on the provider ID.
 */
function resolveChecker(providerId: string | undefined): DeploymentAdminChecker {
    if (providerId) {
        const item = registry.get(providerId);
        if (item) {
            return item.create();
        }
    }
    return new NoOpDeploymentAdminChecker();
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
