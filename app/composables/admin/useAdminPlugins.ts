import { computed, reactive, shallowRef, defineAsyncComponent, type Component } from 'vue';
import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';
import { getContributionSurfaceKernel } from '~/composables/plugins/contribution-surface-kernel';

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
const legacyComponentCache = new Map<
    string,
    ReturnType<typeof defineAsyncComponent>
>();
const v2ComponentCache = new Map<
    string,
    ReturnType<typeof defineAsyncComponent>
>();

function useV2Surface(): boolean {
    return getContributionSurfaceSelection().isSelected('admin-extensions');
}

function getComponentCache() {
    return useV2Surface() ? v2ComponentCache : legacyComponentCache;
}

function setComponentCache(id: string, component: ReturnType<typeof defineAsyncComponent>) {
    const componentCache = getComponentCache();
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

const pageV2Kernel = getContributionSurfaceKernel<AdminPageDef>(
    'admin-extensions',
    {
        getId: (page) => page.id,
        normalize: normalizePage,
    },
    'pages'
);
const widgetV2Kernel = getContributionSurfaceKernel<AdminWidgetDef>(
    'admin-extensions',
    {
        getId: (widget) => widget.id,
    },
    'widgets'
);

pageV2Kernel.registry.subscribe(() => {
    if (useV2Surface()) state.pages = [...pageV2Kernel.items.value];
});
widgetV2Kernel.registry.subscribe(() => {
    if (useV2Surface()) state.widgets = [...widgetV2Kernel.items.value];
});

export function registerAdminPage(def: AdminPageDef) {
    if (useV2Surface()) {
        pageV2Kernel.registry.registerLegacy({ value: def });
        return;
    }
    const normalized = normalizePage(def);
    const existingIndex = state.pages.findIndex((page) => page.id === normalized.id);
    if (existingIndex >= 0) {
        state.pages.splice(existingIndex, 1, normalized);
    } else {
        state.pages.push(normalized);
    }
}

export function registerAdminWidget(def: AdminWidgetDef) {
    if (useV2Surface()) {
        widgetV2Kernel.registry.registerLegacy({ value: def });
        return;
    }
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
    const componentCache = getComponentCache();
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
const loadedV2 = shallowRef(false);

export async function loadAdminPlugins() {
    if (useV2Surface()) {
        if (loadedV2.value) return;
        loadedV2.value = true;
    } else {
        if (loaded.value) return;
        loaded.value = true;
    }

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
