import type {
    EnrichedConfigEntry,
    StatusResponse,
} from './useAdminTypes';
import type { ExtensionItem } from './useAdminExtensions';

import { useFetch } from '#app';

// Helper to ensure credentials are always included for admin API calls
const adminFetchOptions = {
    credentials: 'include' as const,
};

export function useAdminSession() {
    return useFetch<{ authenticated: boolean; kind: string; workspace?: { id: string; name: string } | null }>(
        '/api/admin/auth/session',
        {
            key: 'admin:auth:session',
            dedupe: 'defer',
            getCachedData: (key, nuxtApp) =>
                nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
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

export function useAdminExtensions() {
    return useFetch<{ items: ExtensionItem[] }>('/api/admin/extensions', {
        key: 'admin:extensions',
        dedupe: 'defer',
        ...adminFetchOptions,
        server: false,
    });
}

export function useAdminSystemConfigEnriched() {
    return useFetch<{ entries: EnrichedConfigEntry[]; savedRevision?: string | null; siteRevision: string; themes: Array<{label: string; value: string}> }>(
        '/api/admin/system/config/enriched',
        {
            key: 'admin:system:config:enriched',
            dedupe: 'defer',
            ...adminFetchOptions,
            server: false,
        }
    );
}
