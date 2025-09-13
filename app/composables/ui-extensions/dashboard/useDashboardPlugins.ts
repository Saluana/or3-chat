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

function syncPages(pluginId: string) {
    const m = pageRegistry.get(pluginId);
    reactivePages[pluginId] = m ? Array.from(m.values()) : [];
}

function sync() {
    reactiveList.items = Array.from(registry.values());
}

export function registerDashboardPlugin(plugin: DashboardPlugin) {
    registry.set(plugin.id, plugin);
    sync();
    // If inline pages provided, replace existing pages for that plugin
    if (plugin.pages) {
        unregisterDashboardPluginPage(plugin.id); // clear existing pages
        for (const p of plugin.pages) registerDashboardPluginPage(plugin.id, p);
    }
}

export function unregisterDashboardPlugin(id: string) {
    if (registry.delete(id)) sync();
    // Optionally keep pages? For now remove associated pages for cleanliness.
    unregisterDashboardPluginPage(id);
}

export function useDashboardPlugins() {
    return computed(() =>
        reactiveList.items.sort((a, b) => (a.order ?? 200) - (b.order ?? 200))
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
    m.set(page.id, page);
    syncPages(pluginId);
}

export function unregisterDashboardPluginPage(
    pluginId: string,
    pageId?: string
) {
    const m = pageRegistry.get(pluginId);
    if (!m) return;
    if (pageId) m.delete(pageId);
    else pageRegistry.delete(pluginId);
    syncPages(pluginId);
}

export function useDashboardPluginPages(pluginId: () => string | undefined) {
    return computed(() => {
        const id = pluginId();
        if (!id) return [] as DashboardPluginPage[];
        const list = reactivePages[id] || [];
        return [...list].sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
    });
}

export function listDashboardPluginPages(
    pluginId: string
): DashboardPluginPage[] {
    const list = reactivePages[pluginId] || [];
    return [...list].sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
}

export function getDashboardPluginPage(
    pluginId: string,
    pageId: string
): DashboardPluginPage | undefined {
    return pageRegistry.get(pluginId)?.get(pageId);
}

// Component resolution cache
const pageComponentCache = new Map<string, Component>();

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
    }
    pageComponentCache.set(key, comp);
    return comp;
}

// Minimal built‑in examples can be registered in a plugin file separately; keeping
// this composable focused only on registry mechanics (mirrors other ui-extension patterns).
