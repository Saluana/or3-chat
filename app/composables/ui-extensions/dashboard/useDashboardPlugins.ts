import { reactive, computed, type Component } from 'vue';

export interface DashboardPlugin {
    /** Unique id across all dashboard plugins */
    id: string;
    /** Icon name (Iconify) shown in the grid */
    icon: string;
    /** Short label shown under the icon */
    label: string;
    /** Optional longer description (tooltip or detail panel later) */
    description?: string;
    /** Optional order (lower = earlier). Defaults to 200. */
    order?: number;
    /** Optional click handler when user activates the icon. */
    handler?: (ctx: { id: string }) => void | Promise<void>;
    /** Optional pages declared inline on registration (normalized into page registry). */
    pages?: DashboardPluginPage[];
}

export interface DashboardPluginPage {
    /** Unique within the plugin. */
    id: string;
    /** Display title. */
    title: string;
    /** Optional icon for page navigation lists. */
    icon?: string;
    /** Ordering (lower first). Defaults to 200. */
    order?: number;
    /** Optional description used in landing list. */
    description?: string;
    /** Component or async factory returning component (lazy loaded). */
    component: Component | (() => Promise<any>);
}

// Global singleton (survives HMR)
const g: any = globalThis as any;
const registry: Map<string, DashboardPlugin> =
    g.__or3DashboardPluginsRegistry ||
    (g.__or3DashboardPluginsRegistry = new Map());

// Reactive projection for consumers
const reactiveList = reactive<{ items: DashboardPlugin[] }>({ items: [] });

// Pages registry (per plugin -> page map)
const pageRegistry: Map<
    string,
    Map<string, DashboardPluginPage>
> = g.__or3DashboardPluginPagesRegistry ||
(g.__or3DashboardPluginPagesRegistry = new Map());

const reactivePages = reactive<{ [pluginId: string]: DashboardPluginPage[] }>(
    {}
);

// Order constant (avoid magic number repetition)
const DEFAULT_ORDER = 200;

// Component resolution cache
const pageComponentCache = new Map<string, Component>();

function deletePageCache(pluginId: string, pageId: string) {
    pageComponentCache.delete(`${pluginId}:${pageId}`);
}

function deleteAllPluginPageCache(pluginId: string) {
    for (const key of pageComponentCache.keys()) {
        if (key.startsWith(pluginId + ':')) pageComponentCache.delete(key);
    }
}

function syncPages(pluginId: string) {
    const m = pageRegistry.get(pluginId);
    reactivePages[pluginId] = m ? Array.from(m.values()) : [];
}

function sync() {
    // Expose a shallow copy array so that consumer sorts don't mutate source
    reactiveList.items = Array.from(registry.values());
}

export function registerDashboardPlugin(plugin: DashboardPlugin) {
    if (process.dev && registry.has(plugin.id)) {
        // eslint-disable-next-line no-console
        console.warn(
            `[dashboard] Overwriting existing plugin id "${plugin.id}"`
        );
    }
    // Freeze to prevent external mutation; copy pages array so later mutations by caller don't leak in.
    const frozen = Object.freeze({
        ...plugin,
        pages: plugin.pages ? [...plugin.pages] : undefined,
    });
    registry.set(plugin.id, frozen as DashboardPlugin);
    sync();
    // If inline pages provided, replace existing pages for that plugin in a single pass (avoid redundant sync cycles)
    if (plugin.pages) {
        unregisterDashboardPluginPage(plugin.id); // clear existing pages + cache
        for (const p of plugin.pages) registerDashboardPluginPage(plugin.id, p);
    }
}

export function unregisterDashboardPlugin(id: string) {
    if (registry.delete(id)) sync();
    unregisterDashboardPluginPage(id); // also clears pages + cache + reactivePages entry
    deleteAllPluginPageCache(id);
    delete (reactivePages as any)[id];
}

export function useDashboardPlugins() {
    return computed(() =>
        [...reactiveList.items].sort(
            (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
        )
    );
}

export function listRegisteredDashboardPluginIds(): string[] {
    return Array.from(registry.keys());
}

// ----- Pages API -----

export function registerDashboardPluginPage(
    pluginId: string,
    page: DashboardPluginPage
) {
    let m = pageRegistry.get(pluginId);
    if (!m) {
        m = new Map();
        pageRegistry.set(pluginId, m);
    }
    // Invalidate any cached component for this page id prior to replacement
    deletePageCache(pluginId, page.id);
    const frozen = Object.freeze({ ...page });
    m.set(page.id, frozen);
    syncPages(pluginId);
}

export function unregisterDashboardPluginPage(
    pluginId: string,
    pageId?: string
) {
    const m = pageRegistry.get(pluginId);
    if (!m) return;
    if (pageId) {
        m.delete(pageId);
        deletePageCache(pluginId, pageId);
    } else {
        // remove all pages + their cache entries
        for (const id of m.keys()) deletePageCache(pluginId, id);
        pageRegistry.delete(pluginId);
        deleteAllPluginPageCache(pluginId);
    }
    if (!pageId) {
        delete (reactivePages as any)[pluginId];
    }
    syncPages(pluginId);
}

export function useDashboardPluginPages(pluginId: () => string | undefined) {
    return computed(() => {
        const id = pluginId();
        if (!id) return [] as DashboardPluginPage[];
        const list = reactivePages[id] || [];
        return [...list].sort(
            (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
        );
    });
}

export function listDashboardPluginPages(
    pluginId: string
): DashboardPluginPage[] {
    const list = reactivePages[pluginId] || [];
    return [...list].sort(
        (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
    );
}

export function getDashboardPluginPage(
    pluginId: string,
    pageId: string
): DashboardPluginPage | undefined {
    return pageRegistry.get(pluginId)?.get(pageId);
}

export async function resolveDashboardPluginPageComponent(
    pluginId: string,
    pageId: string
): Promise<Component | undefined> {
    const key = `${pluginId}:${pageId}`;
    if (pageComponentCache.has(key)) return pageComponentCache.get(key);
    const page = getDashboardPluginPage(pluginId, pageId);
    if (!page) return;
    let comp: any = page.component;
    if (
        typeof comp === 'function' &&
        !(comp as any).render &&
        !(comp as any).setup
    ) {
        const loaded = await (comp as () => Promise<any>)();
        comp = loaded?.default || loaded;
        if (process.dev && (typeof comp !== 'object' || !comp)) {
            // eslint-disable-next-line no-console
            console.warn(
                `[dashboard] Async page loader for ${pluginId}:${pageId} returned non-component`,
                comp
            );
        }
    }
    pageComponentCache.set(key, comp);
    return comp;
}

// Minimal built‑in examples can be registered in a plugin file separately; keeping
// this composable focused only on registry mechanics (mirrors other ui-extension patterns).
