import { useRuntimeConfig } from '#imports';

export interface RuntimeConfigRegistryItem<T> {
    id: string;
    order?: number;
    create: () => T;
}

export interface RuntimeConfigRegistryOptions<T> {
    warnLabel: string;
    cacheInstances?: boolean;
    resolveActiveId: (config: ReturnType<typeof useRuntimeConfig>) => string | null | undefined;
}

export interface RuntimeConfigRegistry<T, TItem extends RuntimeConfigRegistryItem<T>> {
    register(item: TItem): void;
    get(id: string): T | null;
    getActive(): T | null;
    listIds(): string[];
}

export function createRuntimeConfigRegistry<
    T,
    TItem extends RuntimeConfigRegistryItem<T>,
>(options: RuntimeConfigRegistryOptions<T>): RuntimeConfigRegistry<T, TItem> {
    const items = new Map<string, TItem>();
    const instances = new Map<string, T>();
    const cacheInstances = options.cacheInstances ?? false;

    function register(item: TItem): void {
        if (import.meta.dev && items.has(item.id)) {
            console.warn(`[${options.warnLabel}] Replacing item: ${item.id}`);
        }

        items.set(item.id, item);
        instances.delete(item.id);
    }

    function get(id: string): T | null {
        if (!id) {
            return null;
        }

        const item = items.get(id);
        if (!item) {
            return null;
        }

        if (!cacheInstances) {
            return item.create();
        }

        const cached = instances.get(id);
        if (cached) {
            return cached;
        }

        const instance = item.create();
        instances.set(id, instance);
        return instance;
    }

    function getActive(): T | null {
        const providerId = options.resolveActiveId(useRuntimeConfig());
        return providerId ? get(providerId) : null;
    }

    function listIds(): string[] {
        return Array.from(items.keys());
    }

    return {
        register,
        get,
        getActive,
        listIds,
    };
}
