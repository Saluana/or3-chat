import { computed, reactive, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';

export interface RegistryItem {
    id: string;
    order?: number;
}

export interface RegistryApi<T extends RegistryItem> {
    register(item: T): void;
    unregister(id: string): void;
    listIds(): string[];
    snapshot(): T[];
    useItems(): ComputedRef<readonly T[]>;
}

const DEFAULT_ORDER = 200;

function defaultSort<T extends RegistryItem>(a: T, b: T) {
    return (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER);
}

/**
 * Create a Vue-reactive global registry. Used for plugin registries that
 * must persist across component lifecycles and HMR.
 */
export function useGlobalRegistry<T extends object>(
    key: string,
    init: () => T
): T {
    const globalKey = `__or3_${key}`;
    const store = globalThis as unknown as Record<string, T>;
    if (!store[globalKey]) {
        store[globalKey] = reactive(init()) as T;
    }
    return store[globalKey];
}

export function createRegistry<T extends RegistryItem>(
    globalKey: string,
    sortFn: (a: T, b: T) => number = defaultSort
): RegistryApi<T> {
    const g: any = globalThis as any;
    const registry: Map<string, T> =
        g[globalKey] || (g[globalKey] = new Map<string, T>());

    const store: ShallowRef<T[]> = shallowRef([]);

    function sync() {
        store.value = Array.from(registry.values());
    }

    function register(item: T) {
        if (import.meta.dev && registry.has(item.id)) {
            console.warn(`[registry:${globalKey}] Replacing id: ${item.id}`);
        }
        const frozen = Object.freeze({ ...item });
        registry.set(item.id, frozen);
        sync();
    }

    function unregister(id: string) {
        if (registry.delete(id)) sync();
    }

    function listIds() {
        return Array.from(registry.keys());
    }

    function snapshot(): T[] {
        return store.value.slice();
    }

    function useItems(): ComputedRef<readonly T[]> {
        return computed(() => [...store.value].sort(sortFn));
    }

    if (!store.value.length && registry.size) {
        sync();
    }

    return {
        register,
        unregister,
        listIds,
        snapshot,
        useItems,
    };
}
