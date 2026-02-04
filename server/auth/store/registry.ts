import type { H3Event } from 'h3';
import type { AuthWorkspaceStore } from './types';

export interface AuthWorkspaceStoreRegistryItem {
    id: string;
    order?: number;
    create: (event: H3Event) => AuthWorkspaceStore;
}

const stores = new Map<string, AuthWorkspaceStoreRegistryItem>();

export function registerAuthWorkspaceStore(
    item: AuthWorkspaceStoreRegistryItem
): void {
    if (import.meta.dev && stores.has(item.id)) {
        console.warn(`[auth:store] Replacing workspace store: ${item.id}`);
    }
    stores.set(item.id, item);
}

export function getAuthWorkspaceStore(
    id: string,
    event: H3Event
): AuthWorkspaceStore | null {
    const item = stores.get(id);
    return item ? item.create(event) : null;
}

export function listAuthWorkspaceStoreIds(): string[] {
    return Array.from(stores.keys());
}
