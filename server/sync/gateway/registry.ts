import type { SyncGatewayAdapter } from './types';

export interface SyncGatewayAdapterRegistryItem {
    id: string;
    order?: number;
    create: () => SyncGatewayAdapter;
}

const adapters = new Map<string, SyncGatewayAdapterRegistryItem>();

export function registerSyncGatewayAdapter(
    item: SyncGatewayAdapterRegistryItem
): void {
    if (import.meta.dev && adapters.has(item.id)) {
        console.warn(`[sync:gateway] Replacing adapter: ${item.id}`);
    }
    adapters.set(item.id, item);
}

export function getSyncGatewayAdapter(id: string): SyncGatewayAdapter | null {
    const item = adapters.get(id);
    return item ? item.create() : null;
}

export function listSyncGatewayAdapterIds(): string[] {
    return Array.from(adapters.keys());
}
