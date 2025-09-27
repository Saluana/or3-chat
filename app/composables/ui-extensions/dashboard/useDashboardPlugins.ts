import {
    reactive,
    computed,
    readonly,
    shallowRef,
    type Component,
    type ShallowRef,
} from 'vue';

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

export type DashboardNavigationErrorCode =
    | 'missing-plugin'
    | 'missing-page'
    | 'handler-error'
    | 'resolve-error';

export interface DashboardNavigationError {
    code: DashboardNavigationErrorCode;
    message: string;
    pluginId?: string;
    pageId?: string;
    cause?: unknown;
}

export interface DashboardNavigationState {
    view: 'dashboard' | 'page';
    activePluginId: string | null;
    activePageId: string | null;
    loadingPage: boolean;
    error: DashboardNavigationError | null;
}

export type DashboardNavigationResult =
    | { ok: true }
    | { ok: false; error: DashboardNavigationError };

export interface UseDashboardNavigationOptions {
    baseItems?: DashboardPlugin[];
}

interface DashboardNavigationRuntime {
    state: DashboardNavigationState;
    resolvedComponent: ShallowRef<Component | null>;
    baseItems: ShallowRef<DashboardPlugin[]>;
}

function deletePageCache(pluginId: string, pageId: string) {
    pageComponentCache.delete(`${pluginId}:${pageId}`);
}

function deleteAllPluginPageCache(pluginId: string) {
    for (const key of pageComponentCache.keys()) {
        if (key.startsWith(pluginId + ':')) pageComponentCache.delete(key);
    }
}

const navigationRuntime: DashboardNavigationRuntime =
    g.__or3DashboardNavigationRuntime ||
    (g.__or3DashboardNavigationRuntime = {
        state: reactive<DashboardNavigationState>({
            view: 'dashboard',
            activePluginId: null,
            activePageId: null,
            loadingPage: false,
            error: null,
        }),
        resolvedComponent: shallowRef<Component | null>(null),
        baseItems: shallowRef<DashboardPlugin[]>([]),
    });

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

export function useDashboardNavigation(
    options: UseDashboardNavigationOptions = {}
) {
    if (options.baseItems !== undefined) {
        navigationRuntime.baseItems.value = [...options.baseItems];
    } else if (!navigationRuntime.baseItems.value) {
        navigationRuntime.baseItems.value = [];
    }

    const state = navigationRuntime.state;
    const resolved = navigationRuntime.resolvedComponent;
    const registered = useDashboardPlugins();

    const dashboardItems = computed(() => {
        const map = new Map<string, DashboardPlugin>();
        for (const item of navigationRuntime.baseItems.value) {
            map.set(item.id, item);
        }
        for (const plugin of registered.value) {
            map.set(plugin.id, plugin);
        }
        return Array.from(map.values()).sort(
            (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
        );
    });

    const landingPages = computed(() => {
        const pluginId = state.activePluginId;
        if (!pluginId) return [] as DashboardPluginPage[];
        return listDashboardPluginPages(pluginId);
    });

    const headerPluginLabel = computed(() => {
        if (!state.activePluginId) return 'Dashboard';
        const match = dashboardItems.value.find(
            (item) => item.id === state.activePluginId
        );
        return match?.label ?? state.activePluginId;
    });

    const activePageTitle = computed(() => {
        if (!state.activePluginId || !state.activePageId) return '';
        const page = listDashboardPluginPages(state.activePluginId).find(
            (entry) => entry.id === state.activePageId
        );
        return page?.title ?? state.activePageId;
    });

    const clearError = () => {
        state.error = null;
    };

    const setError = (
        error: DashboardNavigationError
    ): DashboardNavigationResult => {
        state.error = error;
        return { ok: false, error };
    };

    const ensurePlugin = (pluginId: string) =>
        dashboardItems.value.find((item) => item.id === pluginId);

    const openPlugin = async (
        pluginId: string
    ): Promise<DashboardNavigationResult> => {
        clearError();
        const plugin = ensurePlugin(pluginId);
        if (!plugin) {
            state.view = 'dashboard';
            state.activePluginId = null;
            state.activePageId = null;
            resolved.value = null;
            state.loadingPage = false;
            return setError({
                code: 'missing-plugin',
                pluginId,
                message: `Dashboard plugin "${pluginId}" was not found`,
            });
        }

        state.activePluginId = pluginId;
        state.activePageId = null;
        state.loadingPage = false;
        resolved.value = null;

        const pages = listDashboardPluginPages(pluginId);
        if (!pages.length) {
            try {
                await plugin.handler?.({ id: pluginId });
            } catch (cause) {
                return setError({
                    code: 'handler-error',
                    pluginId,
                    message: `Dashboard plugin "${pluginId}" handler failed`,
                    cause,
                });
            }
            state.view = 'dashboard';
            return { ok: true };
        }

        if (pages.length === 1) {
            return openPage(pluginId, pages[0]!.id);
        }

        state.view = 'page';
        return { ok: true };
    };

    const openPage = async (
        pluginId: string,
        pageId: string
    ): Promise<DashboardNavigationResult> => {
        clearError();
        const plugin = ensurePlugin(pluginId);
        if (!plugin) {
            state.view = 'dashboard';
            state.activePluginId = null;
            state.activePageId = null;
            resolved.value = null;
            state.loadingPage = false;
            return setError({
                code: 'missing-plugin',
                pluginId,
                pageId,
                message: `Dashboard plugin "${pluginId}" was not found`,
            });
        }

        state.view = 'page';
        state.activePluginId = pluginId;
        state.activePageId = pageId;
        state.loadingPage = true;
        resolved.value = null;

        const page = getDashboardPluginPage(pluginId, pageId);
        if (!page) {
            state.loadingPage = false;
            state.activePageId = null;
            return setError({
                code: 'missing-page',
                pluginId,
                pageId,
                message: `Dashboard page "${pageId}" was not found for plugin "${pluginId}"`,
            });
        }

        try {
            const component = await resolveDashboardPluginPageComponent(
                pluginId,
                pageId
            );
            state.loadingPage = false;
            if (!component) {
                state.activePageId = null;
                return setError({
                    code: 'resolve-error',
                    pluginId,
                    pageId,
                    message: `Dashboard page "${pageId}" failed to load`,
                });
            }
            resolved.value = component;
            return { ok: true };
        } catch (cause) {
            state.loadingPage = false;
            state.activePageId = null;
            return setError({
                code: 'resolve-error',
                pluginId,
                pageId,
                message: `Dashboard page "${pageId}" failed to load`,
                cause,
            });
        }
    };

    const goBack = () => {
        clearError();
        if (state.view === 'dashboard') return;
        const pluginId = state.activePluginId;
        if (!pluginId) {
            reset();
            return;
        }

        if (state.activePageId) {
            const pages = listDashboardPluginPages(pluginId);
            state.activePageId = null;
            resolved.value = null;
            state.loadingPage = false;
            if (pages.length <= 1) {
                reset();
            }
            return;
        }

        reset();
    };

    function reset() {
        state.view = 'dashboard';
        state.activePluginId = null;
        state.activePageId = null;
        state.loadingPage = false;
        resolved.value = null;
        state.error = null;
    }

    return {
        state: readonly(state),
        resolvedPageComponent: readonly(resolved),
        dashboardItems,
        landingPages,
        headerPluginLabel,
        activePageTitle,
        openPlugin,
        openPage,
        goBack,
        reset,
    };
}
