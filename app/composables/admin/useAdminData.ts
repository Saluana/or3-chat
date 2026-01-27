import type {
    EnrichedConfigEntry,
    StatusResponse,
    WorkspaceResponse,
} from './useAdminTypes';
import type { ExtensionItem } from './useAdminExtensions';

import { useFetch } from '#app';

export function useAdminSystemStatus() {
    return useFetch<StatusResponse>('/api/admin/system/status', {
        key: 'admin:system:status',
        dedupe: 'defer',
    });
}

export function useAdminWorkspace() {
    return useFetch<WorkspaceResponse>('/api/admin/workspace', {
        key: 'admin:workspace',
        dedupe: 'defer',
    });
}

export function useAdminExtensions() {
    return useFetch<{ items: ExtensionItem[] }>('/api/admin/extensions', {
        key: 'admin:extensions',
        dedupe: 'defer',
    });
}

export function useAdminSystemConfigEnriched() {
    return useFetch<{ entries: EnrichedConfigEntry[] }>(
        '/api/admin/system/config/enriched',
        {
            key: 'admin:system:config:enriched',
            dedupe: 'defer',
        }
    );
}

export function useAdminSystemConfig() {
    return useFetch<{ entries: Array<{ key: string; value: string | null }> }>(
        '/api/admin/system/config',
        {
            key: 'admin:system:config',
            dedupe: 'defer',
        }
    );
}
