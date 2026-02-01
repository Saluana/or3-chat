import type {
    EnrichedConfigEntry,
    StatusResponse,
    WorkspaceResponse,
} from './useAdminTypes';
import type { ExtensionItem } from './useAdminExtensions';

import { useFetch } from '#app';
import { computed, unref, watch, type Ref } from 'vue';

// Helper to ensure credentials are always included for admin API calls
const adminFetchOptions = {
    credentials: 'include' as const,
};

type MaybeRef<T> = T | Ref<T>;

export function useAdminSession() {
    return useFetch<{ authenticated: boolean; kind: string }>(
        '/api/admin/auth/session',
        {
            key: 'admin:auth:session',
            dedupe: 'defer',
            ...adminFetchOptions,
            server: false,
        }
    );
}

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
export function useAdminWorkspace(workspaceId?: MaybeRef<string | null | undefined>) {
    const { data: session } = useAdminSession();
    const resolvedWorkspaceId = computed(() => unref(workspaceId) ?? undefined);
    const shouldFetch = computed(() => {
        if (resolvedWorkspaceId.value) return true;
        // For super admins, require explicit workspace selection
        if (session.value?.kind === 'super_admin') return false;
        // Default: allow server to resolve workspace from session
        return session.value?.authenticated === true;
    });

    const fetchResult = useFetch<WorkspaceResponse>(
        () =>
            resolvedWorkspaceId.value
                ? `/api/admin/workspace?workspaceId=${encodeURIComponent(resolvedWorkspaceId.value)}`
                : '/api/admin/workspace',
        {
            key: () =>
                resolvedWorkspaceId.value
                    ? `admin:workspace:${resolvedWorkspaceId.value}`
                    : 'admin:workspace',
            dedupe: 'defer',
            ...adminFetchOptions,
            server: false, // Only fetch client-side for super admin context
            immediate: false,
        }
    );

    watch(
        [shouldFetch, resolvedWorkspaceId],
        ([canFetch]) => {
            if (canFetch) {
                fetchResult.refresh();
            }
        },
        { immediate: true }
    );

    return fetchResult;
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
        retry: 3,
        retryDelay: 1000,
    });
}
