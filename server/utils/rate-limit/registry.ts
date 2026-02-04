import type { RateLimitProvider } from './types';

export interface RateLimitProviderRegistryItem {
    id: string;
    order?: number;
    create: () => RateLimitProvider;
}

const providers = new Map<string, RateLimitProviderRegistryItem>();

export function registerRateLimitProvider(
    item: RateLimitProviderRegistryItem
): void {
    if (import.meta.dev && providers.has(item.id)) {
        console.warn(`[rate-limit] Replacing provider: ${item.id}`);
    }
    providers.set(item.id, item);
}

export function getRateLimitProviderById(
    id: string
): RateLimitProvider | null {
    const item = providers.get(id);
    return item ? item.create() : null;
}

export function listRateLimitProviderIds(): string[] {
    return Array.from(providers.keys());
}
