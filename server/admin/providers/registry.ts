import type { ProviderAdminAdapter, ProviderKind } from './types';

const adapters = new Map<string, ProviderAdminAdapter>();

function key(kind: ProviderKind, id: string) {
    return `${kind}:${id}`;
}

export function registerProviderAdminAdapter(adapter: ProviderAdminAdapter): void {
    const adapterKey = key(adapter.kind, adapter.id);
    if (import.meta.dev && adapters.has(adapterKey)) {
        console.warn(`[admin:providers] Replacing adapter: ${adapterKey}`);
    }
    adapters.set(adapterKey, adapter);
}

export function getProviderAdminAdapter(
    kind: ProviderKind,
    id: string
): ProviderAdminAdapter | null {
    return adapters.get(key(kind, id)) ?? null;
}

export function listProviderAdminAdapters(kind?: ProviderKind): ProviderAdminAdapter[] {
    const values = Array.from(adapters.values());
    if (!kind) return values;
    return values.filter((adapter) => adapter.kind === kind);
}
