/**
 * @module server/admin/stores/registry.ts
 *
 * Purpose:
 * Acts as a service registry or factory that resolves abstract store interfaces
 * to their provider-specific implementations.
 *
 * Responsibilities:
 * - Directing store requests to the appropriate provider (e.g., Convex).
 * - Caching provider capabilities to avoid redundant lookups.
 * - Providing a unified set of factory functions for the Admin API.
 *
 * Architecture:
 * This is a middleware-like layer that reads the global sync configuration
 * (`config.sync.provider`) and returns the corresponding store instances.
 * It ensures that the admin API doesn't need to know which database is in use.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import type {
    WorkspaceAccessStore,
    WorkspaceSettingsStore,
    AdminUserStore,
    AdminStoreCapabilities,
} from './types';
import {
    createConvexWorkspaceAccessStore,
    createConvexWorkspaceSettingsStore,
    createConvexAdminUserStore,
} from './convex/convex-store';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

let cachedCapabilities: AdminStoreCapabilities | null = null;
let cachedProviderId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Resolves the appropriate WorkspaceAccessStore for the current environment.
 *
 * @param event - The current H3 event used to resolve runtime configuration.
 * @throws 501 Error if no store implementation exists for the active provider.
 */
export function getWorkspaceAccessStore(event: H3Event): WorkspaceAccessStore {
    const config = useRuntimeConfig(event);
    const provider = config.sync.provider;

    if (provider === CONVEX_PROVIDER_ID) {
        return createConvexWorkspaceAccessStore(event);
    }

    throw createError({
        statusCode: 501,
        statusMessage: `Workspace access store not implemented for provider: ${provider}`,
    });
}

/**
 * Resolves the appropriate WorkspaceSettingsStore for the current environment.
 *
 * @param event - The current H3 event used to resolve runtime configuration.
 * @throws 501 Error if no store implementation exists for the active provider.
 */
export function getWorkspaceSettingsStore(event: H3Event): WorkspaceSettingsStore {
    const config = useRuntimeConfig(event);
    const provider = config.sync.provider;

    if (provider === CONVEX_PROVIDER_ID) {
        return createConvexWorkspaceSettingsStore(event);
    }

    throw createError({
        statusCode: 501,
        statusMessage: `Workspace settings store not implemented for provider: ${provider}`,
    });
}

/**
 * Resolves the appropriate AdminUserStore for the current environment.
 *
 * @param event - The current H3 event used to resolve runtime configuration.
 * @throws 501 Error if no store implementation exists for the active provider.
 */
export function getAdminUserStore(event: H3Event): AdminUserStore {
    const config = useRuntimeConfig(event);
    const provider = config.sync.provider;

    if (provider === CONVEX_PROVIDER_ID) {
        return createConvexAdminUserStore(event);
    }

    throw createError({
        statusCode: 501,
        statusMessage: `Admin user store not implemented for provider: ${provider}`,
    });
}

/**
 * Retrieves the administrative capabilities of the active store provider.
 *
 * Behavior:
 * Caches the results for 1 minute (CACHE_TTL_MS) to reduce configuration
 * lookup overhead during consecutive requests.
 *
 * @param event - Optional H3 event. If missing, system defaults are used.
 */
export function getAdminStoreCapabilities(event?: H3Event): AdminStoreCapabilities {
    const config = useRuntimeConfig(event);
    const provider = config.sync.provider;
    const now = Date.now();

    // Return cached capabilities if valid and provider hasn't changed
    if (cachedCapabilities && 
        cachedProviderId === provider && 
        now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedCapabilities;
    }

    const capabilities = getCapabilitiesForProvider(provider);
    cachedCapabilities = capabilities;
    cachedProviderId = provider || null;
    cacheTimestamp = now;

    return capabilities;
}

function getCapabilitiesForProvider(
    provider: string | undefined
): AdminStoreCapabilities {
    switch (provider) {
        case CONVEX_PROVIDER_ID:
            return {
                supportsServerSideAdmin: true,
                supportsUserSearch: true,
                supportsWorkspaceList: true,
                supportsWorkspaceManagement: true,
                supportsDeploymentAdminGrants: true,
            };
        default:
            // Unknown provider - minimal capabilities
            return {
                supportsServerSideAdmin: false,
                supportsUserSearch: false,
                supportsWorkspaceList: false,
                supportsWorkspaceManagement: false,
                supportsDeploymentAdminGrants: false,
            };
    }
}

/**
 * Clear the cached capabilities (useful for testing).
 */
export function clearAdminStoreCache(): void {
    cachedCapabilities = null;
    cachedProviderId = null;
    cacheTimestamp = 0;
}
