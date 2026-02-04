import type { StorageGatewayAdapter } from './types';

export interface StorageGatewayAdapterRegistryItem {
    id: string;
    order?: number;
    create: () => StorageGatewayAdapter;
}

const adapters = new Map<string, StorageGatewayAdapterRegistryItem>();

export function registerStorageGatewayAdapter(
    item: StorageGatewayAdapterRegistryItem
): void {
    if (import.meta.dev && adapters.has(item.id)) {
        console.warn(`[storage:gateway] Replacing adapter: ${item.id}`);
    }
    adapters.set(item.id, item);
}

export function getStorageGatewayAdapter(
    id: string
): StorageGatewayAdapter | null {
    const item = adapters.get(id);
    return item ? item.create() : null;
}

export function listStorageGatewayAdapterIds(): string[] {
    return Array.from(adapters.keys());
}
