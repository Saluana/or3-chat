import { computed, reactive, shallowRef, defineAsyncComponent, type Component } from 'vue';

export type AdminPageDef = {
    id: string;
    label: string;
    path?: string;
    order?: number;
    component: AdminComponent;
};

export type AdminWidgetDef = {
    id: string;
    slot: 'overview' | 'workspace' | 'plugins' | 'themes' | 'system';
    order?: number;
    component: AdminComponent;
};

export type AdminComponent =
    | Component
    | (() => Promise<Component | { default: Component }>);

export interface AdminPlugin {
    id: string;
    register: (api: AdminPluginApi) => void | Promise<void>;
}

export interface AdminPluginApi {
    registerAdminPage: (def: AdminPageDef) => void;
    registerAdminWidget: (def: AdminWidgetDef) => void;
}

export const state = reactive({
    pages: [] as AdminPageDef[],
    widgets: [] as AdminWidgetDef[],
});

const MAX_CACHE_SIZE = 50;
const componentCache = new Map<string, ReturnType<typeof defineAsyncComponent>>();

function setComponentCache(id: string, component: ReturnType<typeof defineAsyncComponent>) {
    if (componentCache.size >= MAX_CACHE_SIZE) {
        const firstKey = componentCache.keys().next().value;
        if (firstKey) componentCache.delete(firstKey);
    }
    componentCache.set(id, component);
}

function normalizePage(def: AdminPageDef): AdminPageDef {
    return {
        ...def,
        path: def.path ?? def.id,
    };
}

export function registerAdminPage(def: AdminPageDef) {
    const normalized = normalizePage(def);
    const existingIndex = state.pages.findIndex((page) => page.id === normalized.id);
    if (existingIndex >= 0) {
        state.pages.splice(existingIndex, 1, normalized);
    } else {
        state.pages.push(normalized);
    }
}

export function registerAdminWidget(def: AdminWidgetDef) {
    const existingIndex = state.widgets.findIndex((w) => w.id === def.id);
    if (existingIndex >= 0) {
        state.widgets.splice(existingIndex, 1, def);
    } else {
        state.widgets.push(def);
    }
}

export function useAdminPages() {
    return computed(() =>
        [...state.pages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    );
}

export function useAdminWidgets(slot?: AdminWidgetDef['slot']) {
    return computed(() => {
        const list = slot
            ? state.widgets.filter((widget) => widget.slot === slot)
            : state.widgets;
        return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });
}

export function resolveAdminComponent(def: { id: string; component: AdminComponent }) {
    if (componentCache.has(def.id)) return componentCache.get(def.id)!;

    if (typeof def.component === 'function') {
        const loader = def.component as () => Promise<Component | { default: Component }>;
        const asyncComponent = defineAsyncComponent(async () => {
            const mod = await loader();
            return (mod as { default?: Component }).default ?? mod;
        });
        setComponentCache(def.id, asyncComponent);
        return asyncComponent;
    }

    return def.component;
}

export function createAdminPluginApi(): AdminPluginApi {
    return {
        registerAdminPage,
        registerAdminWidget,
    };
}

const loaded = shallowRef(false);

export async function loadAdminPlugins() {
    if (loaded.value) return;
    loaded.value = true;

    const modules = import.meta.glob(
        '~~/extensions/admin-plugins/*/admin.plugin.ts'
    ) as Record<string, () => Promise<{ default?: AdminPlugin }>>;
    const api = createAdminPluginApi();

    for (const load of Object.values(modules)) {
        try {
            const mod = await load();
            const plugin = (mod as { default?: AdminPlugin }).default;
            if (!plugin) continue;
            await plugin.register(api);
        } catch (error) {
            if (import.meta.dev) {
                console.error('[admin-plugins] Failed to load admin plugin', error);
            }
        }
    }
}
