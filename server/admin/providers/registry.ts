/**
 * @module server/admin/providers/registry.ts
 *
 * Purpose:
 * Central registration for Provider Admin Adapters. Decouples the Admin Dashboard
 * from specific provider maintenance implementations.
 */
import type { ProviderAdminAdapter, ProviderKind } from './types';

const adapters = new Map<string, ProviderAdminAdapter>();

/**
 * Purpose:
 * Generates a unique lookup key for the internal map.
 */
function key(kind: ProviderKind, id: string) {
    return `${kind}:${id}`;
}

/**
 * Purpose:
 * Registers a maintenance adapter for a provider.
 * Should be called during server bootstrapping.
 */
export function registerProviderAdminAdapter(adapter: ProviderAdminAdapter): void {
    const adapterKey = key(adapter.kind, adapter.id);
    if (import.meta.dev && adapters.has(adapterKey)) {
        console.warn(`[admin:providers] Replacing adapter: ${adapterKey}`);
    }
    adapters.set(adapterKey, adapter);
}

/**
 * Purpose:
 * Retrieves a specific maintenance adapter.
 */
export function getProviderAdminAdapter(
    kind: ProviderKind,
    id: string
): ProviderAdminAdapter | null {
    return adapters.get(key(kind, id)) ?? null;
}

/**
 * Purpose:
 * Lists adapters, optionally filtered by the provider category.
 */
export function listProviderAdminAdapters(kind?: ProviderKind): ProviderAdminAdapter[] {
    const values = Array.from(adapters.values());
    if (!kind) return values;
    return values.filter((adapter) => adapter.kind === kind);
}
