/**
 * @module server/admin/stores/registry.ts
 *
 * Purpose:
 * Acts as a registry that resolves admin store interfaces to provider-specific
 * implementations. Provider packages register their admin store providers
 * during server boot.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import type {
    WorkspaceAccessStore,
    WorkspaceSettingsStore,
    AdminUserStore,
    AdminStoreCapabilities,
} from './types';
import { useRuntimeConfig } from '#imports';

export interface AdminStoreProvider {
    id: string;
    order?: number;
    createWorkspaceAccessStore(event: H3Event): WorkspaceAccessStore;
    createWorkspaceSettingsStore(event: H3Event): WorkspaceSettingsStore;
    createAdminUserStore(event: H3Event): AdminUserStore;
    getCapabilities?: () => AdminStoreCapabilities;
}

const providers = new Map<string, AdminStoreProvider>();

export function registerAdminStoreProvider(provider: AdminStoreProvider): void {
    if (import.meta.dev && providers.has(provider.id)) {
        console.warn(`[admin:stores] Replacing provider: ${provider.id}`);
    }
    providers.set(provider.id, provider);
}

export function getAdminStoreProvider(id: string): AdminStoreProvider | null {
    return providers.get(id) ?? null;
}

function resolveProviderId(event?: H3Event): string {
    const config = useRuntimeConfig(event);
    return config.sync.provider;
}

/**
 * Resolves the appropriate WorkspaceAccessStore for the current environment.
 */
export function getWorkspaceAccessStore(event: H3Event): WorkspaceAccessStore {
    const providerId = resolveProviderId(event);
    const provider = getAdminStoreProvider(providerId);

    if (!provider) {
        throw createError({
            statusCode: 501,
            statusMessage: `Workspace access store not implemented for provider: ${providerId}`,
        });
    }

    return provider.createWorkspaceAccessStore(event);
}

/**
 * Resolves the appropriate WorkspaceSettingsStore for the current environment.
 */
export function getWorkspaceSettingsStore(event: H3Event): WorkspaceSettingsStore {
    const providerId = resolveProviderId(event);
    const provider = getAdminStoreProvider(providerId);

    if (!provider) {
        throw createError({
            statusCode: 501,
            statusMessage: `Workspace settings store not implemented for provider: ${providerId}`,
        });
    }

    return provider.createWorkspaceSettingsStore(event);
}

/**
 * Resolves the appropriate AdminUserStore for the current environment.
 */
export function getAdminUserStore(event: H3Event): AdminUserStore {
    const providerId = resolveProviderId(event);
    const provider = getAdminStoreProvider(providerId);

    if (!provider) {
        throw createError({
            statusCode: 501,
            statusMessage: `Admin user store not implemented for provider: ${providerId}`,
        });
    }

    return provider.createAdminUserStore(event);
}

let cachedCapabilities: AdminStoreCapabilities | null = null;
let cachedProviderId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000;

/**
 * Retrieves the administrative capabilities of the active store provider.
 */
export function getAdminStoreCapabilities(event?: H3Event): AdminStoreCapabilities {
    const providerId = resolveProviderId(event);
    const now = Date.now();

    if (
        cachedCapabilities &&
        cachedProviderId === providerId &&
        now - cacheTimestamp < CACHE_TTL_MS
    ) {
        return cachedCapabilities;
    }

    const provider = getAdminStoreProvider(providerId);
    const capabilities =
        provider?.getCapabilities?.() ??
        {
            supportsServerSideAdmin: false,
            supportsUserSearch: false,
            supportsWorkspaceList: false,
            supportsWorkspaceManagement: false,
            supportsDeploymentAdminGrants: false,
        };

    cachedCapabilities = capabilities;
    cachedProviderId = providerId;
    cacheTimestamp = now;

    return capabilities;
}

/**
 * Clear the cached capabilities (useful for testing).
 */
export function clearAdminStoreCache(): void {
    cachedCapabilities = null;
    cachedProviderId = null;
    cacheTimestamp = 0;
}
