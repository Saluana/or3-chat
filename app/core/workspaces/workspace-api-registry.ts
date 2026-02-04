import { createRegistry } from '~/composables/_registry';
import { useRuntimeConfig } from '#imports';
import type { WorkspaceApi } from './types';

export interface WorkspaceApiRegistryItem {
    id: string;
    order?: number;
    create: () => WorkspaceApi;
}

const registry = createRegistry<WorkspaceApiRegistryItem>(
    '__or3_workspace_api'
);

export const registerWorkspaceApi = registry.register;
export const unregisterWorkspaceApi = registry.unregister;
export const listWorkspaceApiIds = registry.listIds;
export const useWorkspaceApis = registry.useItems;

let cachedApi: WorkspaceApi | null = null;
let cachedApiId: string | null = null;

function getConfiguredProviderId(): string | null {
    const config = useRuntimeConfig();
    return config.public.sync?.provider ?? null;
}

function resolveApi(): WorkspaceApi | null {
    const providerId = getConfiguredProviderId();
    const items = registry.snapshot();
    const byId = providerId
        ? items.find((item) => item.id === providerId)
        : null;
    if (byId) return byId.create();
    const gateway = items.find((item) => item.id === 'gateway');
    return gateway?.create() ?? items[0]?.create() ?? null;
}

export function getActiveWorkspaceApi(): WorkspaceApi | null {
    const providerId = getConfiguredProviderId();
    if (cachedApi && cachedApiId === providerId) {
        return cachedApi;
    }
    cachedApi = resolveApi();
    cachedApiId = providerId;
    return cachedApi;
}

export function _resetWorkspaceApis(): void {
    cachedApi = null;
    cachedApiId = null;
    registry.listIds().forEach((id) => registry.unregister(id));
}
