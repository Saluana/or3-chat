import type {
    EnrichedConfigEntry,
    StatusResponse,
    WorkspaceResponse,
} from './useAdminTypes';
import type { ExtensionItem } from './useAdminExtensions';

import { useFetch } from '#app';

// Helper to ensure credentials are always included for admin API calls
const adminFetchOptions = {
    credentials: 'include' as const,
};

export function useAdminSystemStatus() {
    return useFetch<StatusResponse>('/api/admin/system/status', {
        key: 'admin:system:status',
        dedupe: 'defer',
        ...adminFetchOptions,
        server: false, // Only fetch client-side to avoid hydration mismatch (auth cookies not available during SSR)
    });
}

/**
 * Fetch workspace data. For super admins without a current workspace context,
 * pass a workspaceId to fetch a specific workspace's data.
 */
export function useAdminWorkspace(workspaceId?: string) {
    const url = workspaceId 
        ? `/api/admin/workspace?workspaceId=${workspaceId}` 
        : '/api/admin/workspace';
    
    return useFetch<WorkspaceResponse>(url, {
        key: workspaceId ? `admin:workspace:${workspaceId}` : 'admin:workspace',
        dedupe: 'defer',
        ...adminFetchOptions,
        server: false, // Only fetch client-side for super admin context
    });
}

export function useAdminExtensions() {
    return useFetch<{ items: ExtensionItem[] }>('/api/admin/extensions', {
        key: 'admin:extensions',
        dedupe: 'defer',
        ...adminFetchOptions,
    });
}

export function useAdminSystemConfigEnriched() {
    return useFetch<{ entries: EnrichedConfigEntry[] }>(
        '/api/admin/system/config/enriched',
        {
            key: 'admin:system:config:enriched',
            dedupe: 'defer',
            ...adminFetchOptions,
        }
    );
}

export function useAdminSystemConfig() {
    return useFetch<{ entries: Array<{ key: string; value: string | null }> }>(
        '/api/admin/system/config',
        {
            key: 'admin:system:config',
            dedupe: 'defer',
            ...adminFetchOptions,
        }
    );
}

/**
 * Fetch all workspaces (super admin only)
 */
export function useAdminWorkspacesList() {
    return useFetch<{
        items: Array<{
            id: string;
            name: string;
            memberCount: number;
            ownerEmail?: string;
            deleted?: boolean;
        }>;
        total: number;
    }>('/api/admin/workspaces', {
        key: 'admin:workspaces:list',
        query: { perPage: '100' },
        ...adminFetchOptions,
        server: false,
    });
}
