import type { BackgroundJobProvider } from './types';

export interface BackgroundJobProviderRegistryItem {
    id: string;
    order?: number;
    create: () => BackgroundJobProvider;
}

const providers = new Map<string, BackgroundJobProviderRegistryItem>();

export function registerBackgroundJobProvider(
    item: BackgroundJobProviderRegistryItem
): void {
    if (import.meta.dev && providers.has(item.id)) {
        console.warn(`[background-jobs] Replacing provider: ${item.id}`);
    }
    providers.set(item.id, item);
}

export function getBackgroundJobProviderById(
    id: string
): BackgroundJobProvider | null {
    const item = providers.get(id);
    return item ? item.create() : null;
}

export function listBackgroundJobProviderIds(): string[] {
    return Array.from(providers.keys());
}

export function _resetBackgroundJobProviders(): void {
    providers.clear();
}
