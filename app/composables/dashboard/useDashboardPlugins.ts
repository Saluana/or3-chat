import {
    reactive,
    computed,
    readonly,
    shallowRef,
    markRaw,
    isReactive,
    toRaw,
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
    /**
     * Optional capability declarations for permission-based access control.
     * Standard capabilities:
     * - 'canReadMessages': Read chat messages/history
     * - 'canWriteDocs': Create/modify documents
     * - 'canSend': Send messages or trigger AI operations
     * - 'canReadFiles': Access file attachments
     * - 'canWriteFiles': Upload or modify files
     * - 'canManageThreads': Create/delete/modify threads
     * - 'canAccessSettings': Read or modify app settings
     */
    capabilities?: string[];
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
    component: Component | (() => Promise<{ default?: Component } | Component>);
}

type DashboardGlobals = typeof globalThis & {
    __or3DashboardPluginsRegistry?: Map<string, DashboardPlugin>;
    __or3DashboardPluginPagesRegistry?: Map<
        string,
        Map<string, DashboardPluginPage>
    >;
    __or3DashboardNavigationRuntime?: DashboardNavigationRuntime;
};

// Global singleton (survives HMR)
const g = globalThis as DashboardGlobals;
const registry: Map<string, DashboardPlugin> =
    g.__or3DashboardPluginsRegistry ??
    (g.__or3DashboardPluginsRegistry = new Map<string, DashboardPlugin>());

// Reactive projection for consumers
const reactiveList = reactive<{ items: DashboardPlugin[] }>({ items: [] });

// Pages registry (per plugin -> page map)
const pageRegistry: Map<string, Map<string, DashboardPluginPage>> =
    g.__or3DashboardPluginPagesRegistry ??
    (g.__or3DashboardPluginPagesRegistry = new Map<string, Map<string, DashboardPluginPage>>());

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

/**
 * Purpose:
 * Register a dashboard plugin for discovery and navigation.
 *
 * Behavior:
 * Adds or replaces the plugin entry and normalizes inline pages into the
 * page registry.
 *
 * Constraints:
 * - Plugin IDs must be unique
 * - Inline pages overwrite existing pages for the plugin
 *
 * Non-Goals:
 * - Rendering the plugin UI
 *
 * @example
 * ```ts
 * registerDashboardPlugin({
 *   id: 'my-plugin',
 *   icon: 'i-carbon-apps',
 *   label: 'My Plugin',
 *   pages: [
 *     {
 *       id: 'settings',
 *       title: 'Settings',
 *       component: () => import('~/components/MyPluginSettings.vue'),
 *     },
 *   ],
 * });
 * ```
 */
export function registerDashboardPlugin(plugin: DashboardPlugin) {
    const isDev =
        import.meta.dev ||
        (typeof process !== 'undefined' &&
            (process as { dev?: boolean }).dev === true);
    if (isDev && registry.has(plugin.id)) {
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

/**
 * Purpose:
 * Remove a dashboard plugin and its pages from the registry.
 *
 * Behavior:
 * Deletes the plugin entry and clears associated pages and caches.
 *
 * Constraints:
 * - No-op if the plugin ID is not registered
 *
 * Non-Goals:
 * - Unmounting active UI components
 *
 * @example
 * ```ts
 * unregisterDashboardPlugin('my-plugin');
 * ```
 */
export function unregisterDashboardPlugin(id: string) {
    if (registry.delete(id)) sync();
    unregisterDashboardPluginPage(id); // also clears pages + cache + reactivePages entry
    deleteAllPluginPageCache(id);
    // Using computed property access to safely delete from reactive object
    delete reactivePages[id];
}

/**
 * Purpose:
 * Access the reactive list of registered dashboard plugins.
 *
 * Behavior:
 * Returns a computed list sorted by the order field.
 *
 * Constraints:
 * - Sorting uses the default order constant when missing
 *
 * Non-Goals:
 * - Filtering by capability or visibility
 *
 * @example
 * ```ts
 * const plugins = useDashboardPlugins();
 * ```
 */
export function useDashboardPlugins() {
    return computed(() =>
        [...reactiveList.items].sort(
            (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
        )
    );
}

/**
 * Purpose:
 * Inspect registered dashboard plugin IDs.
 *
 * Behavior:
 * Returns IDs in registration order.
 *
 * Constraints:
 * - Intended for debugging or diagnostics
 *
 * Non-Goals:
 * - Sorting by plugin order
 *
 * @example
 * ```ts
 * const ids = listRegisteredDashboardPluginIds();
 * ```
 */
export function listRegisteredDashboardPluginIds(): string[] {
    return Array.from(registry.keys());
}

// ----- Pages API -----

/**
 * Purpose:
 * Register a page for a dashboard plugin.
 *
 * Behavior:
 * Adds or replaces the page entry and updates the reactive pages list.
 *
 * Constraints:
 * - Page IDs must be unique per plugin
 * - Component instances are marked as raw to avoid reactivity costs
 *
 * Non-Goals:
 * - Loading or mounting the page component
 *
 * @example
 * ```ts
 * registerDashboardPluginPage('my-plugin', {
 *   id: 'overview',
 *   title: 'Overview',
 *   component: () => import('~/components/MyPluginOverview.vue'),
 * });
 * ```
 */
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
    let component = page.component;
    if (isReactive(component)) {
        component = toRaw(component);
    }
    if (typeof component === 'object') {
        component = markRaw(component) as typeof component;
    }

    const frozen = Object.freeze({
        ...page,
        component,
    });
    m.set(page.id, frozen);
    syncPages(pluginId);
}

/**
 * Purpose:
 * Remove a page entry or all pages for a plugin.
 *
 * Behavior:
 * Deletes the page entry and clears cached component instances.
 *
 * Constraints:
 * - No-op if the plugin or page is missing
 *
 * Non-Goals:
 * - Unmounting active page components
 *
 * @example
 * ```ts
 * unregisterDashboardPluginPage('my-plugin', 'overview');
 * ```
 */
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
        delete reactivePages[pluginId];
    }
    syncPages(pluginId);
}

/**
 * Purpose:
 * Access the reactive list of pages for a selected plugin.
 *
 * Behavior:
 * Returns a computed, sorted array for the current plugin ID.
 *
 * Constraints:
 * - Returns an empty list when the plugin ID is missing
 *
 * Non-Goals:
 * - Page access control
 *
 * @example
 * ```ts
 * const pages = useDashboardPluginPages(() => activePluginId.value);
 * ```
 */
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

/**
 * Purpose:
 * Retrieve a sorted list of pages for a plugin.
 *
 * Behavior:
 * Returns a new array sorted by the order field.
 *
 * Constraints:
 * - Only includes pages currently registered
 *
 * Non-Goals:
 * - Resolving page components
 *
 * @example
 * ```ts
 * const pages = listDashboardPluginPages('my-plugin');
 * ```
 */
export function listDashboardPluginPages(
    pluginId: string
): DashboardPluginPage[] {
    const list = reactivePages[pluginId] || [];
    return [...list].sort(
        (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
    );
}

/**
 * Purpose:
 * Find a page definition for a specific plugin.
 *
 * Behavior:
 * Returns the page entry if it exists in the registry.
 *
 * Constraints:
 * - Returns undefined when missing
 *
 * Non-Goals:
 * - Component resolution
 *
 * @example
 * ```ts
 * const page = getDashboardPluginPage('my-plugin', 'overview');
 * ```
 */
export function getDashboardPluginPage(
    pluginId: string,
    pageId: string
): DashboardPluginPage | undefined {
    return pageRegistry.get(pluginId)?.get(pageId);
}

type AsyncComponentLoader = () => Promise<{ default?: Component } | Component>;

function isAsyncLoader(comp: unknown): comp is AsyncComponentLoader {
    if (typeof comp !== 'function') return false;
    // Async factory = 0-arity function without Vue component internals
    // Check for __vccOpts (Vite HMR marker) and length === 0 (factory pattern)
    const fn = comp as Function & { __vccOpts?: unknown; render?: unknown; setup?: unknown };
    return fn.length === 0 && !fn.__vccOpts && !fn.render && !fn.setup;
}

/**
 * Purpose:
 * Resolve and cache the Vue component for a dashboard page.
 *
 * Behavior:
 * Loads async factories, normalizes results, and caches by plugin and page ID.
 *
 * Constraints:
 * - Returns undefined when the page is missing
 * - Async loaders must return a Vue component or default export
 *
 * Non-Goals:
 * - Rendering or mounting the component
 *
 * @example
 * ```ts
 * const component = await resolveDashboardPluginPageComponent(
 *   'my-plugin',
 *   'overview',
 * );
 * ```
 */
export async function resolveDashboardPluginPageComponent(
    pluginId: string,
    pageId: string
): Promise<Component | undefined> {
    const key = `${pluginId}:${pageId}`;
    if (pageComponentCache.has(key)) return pageComponentCache.get(key);
    const page = getDashboardPluginPage(pluginId, pageId);
    if (!page) return;
    let comp: Component | AsyncComponentLoader = page.component;
    if (isReactive(comp)) {
        comp = toRaw(comp);
    }
    if (isAsyncLoader(comp)) {
        const loaded = await comp();
        // Handle both { default: Component } and direct Component returns
        comp = (typeof loaded === 'object' && 'default' in loaded ? loaded.default : loaded) as Component;
        const isDev =
            import.meta.dev ||
            (typeof process !== 'undefined' &&
                (process as { dev?: boolean }).dev === true);
        if (isDev && typeof comp !== 'object') {
             
            console.warn(
                `[dashboard] Async page loader for ${pluginId}:${pageId} returned non-component`,
                comp
            );
        }
    }
    if (isReactive(comp)) {
        comp = toRaw(comp);
    }
    if (typeof comp === 'object') {
        comp = markRaw(comp);
    }
    pageComponentCache.set(key, comp);
    return comp;
}

// Minimal built‑in examples can be registered in a plugin file separately; keeping
// this composable focused only on registry mechanics (mirrors other ui-extension patterns).

/**
 * Purpose:
 * Manage dashboard navigation state across landing and page views.
 *
 * Behavior:
 * Merges base items with registered plugins, tracks current view, and
 * resolves page components on demand.
 *
 * Constraints:
 * - Base items overwrite registered items by ID
 * - Errors are stored in reactive navigation state
 *
 * Non-Goals:
 * - Rendering navigation UI
 *
 * @example
 * ```ts
 * const {
 *   dashboardItems,
 *   openPlugin,
 *   openPage,
 * } = useDashboardNavigation();
 * ```
 */
export function useDashboardNavigation(
    options: UseDashboardNavigationOptions = {}
) {
    if (options.baseItems !== undefined) {
        navigationRuntime.baseItems.value = [...options.baseItems];
    }
    // navigationRuntime.baseItems.value is always initialized, no else needed

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
                state.view = 'dashboard';
                return { ok: true };
            } catch (cause) {
                state.view = 'dashboard';
                state.activePluginId = null;
                return setError({
                    code: 'handler-error',
                    pluginId,
                    message: `Dashboard plugin "${pluginId}" handler failed`,
                    cause,
                });
            }
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

/**
 * Purpose:
 * Check whether a plugin declares a capability string.
 *
 * Behavior:
 * Returns true only when the plugin exists and lists the capability.
 *
 * Constraints:
 * - Returns false when the plugin is missing
 *
 * Non-Goals:
 * - Permission enforcement
 *
 * @example
 * ```ts
 * const canRead = hasCapability('my-plugin', 'canReadMessages');
 * ```
 */
export function hasCapability(pluginId: string, capability: string): boolean {
    const plugin = registry.get(pluginId);
    if (!plugin) return false;
    if (!plugin.capabilities || !Array.isArray(plugin.capabilities)) {
        return false;
    }
    return plugin.capabilities.includes(capability);
}

/**
 * Purpose:
 * Read all declared capabilities for a plugin.
 *
 * Behavior:
 * Returns a copy of the capability list or an empty array.
 *
 * Constraints:
 * - Returns empty list when the plugin is missing
 *
 * Non-Goals:
 * - Validation of capability names
 *
 * @example
 * ```ts
 * const caps = getPluginCapabilities('my-plugin');
 * ```
 */
export function getPluginCapabilities(pluginId: string): string[] {
    const plugin = registry.get(pluginId);
    if (!plugin || !plugin.capabilities) return [];
    return [...plugin.capabilities];
}

/**
 * Purpose:
 * Validate that a plugin declares every required capability.
 *
 * Behavior:
 * Returns true when all provided capabilities are present.
 *
 * Constraints:
 * - Returns false when the plugin is missing
 *
 * Non-Goals:
 * - Authorization enforcement
 *
 * @example
 * ```ts
 * const ok = hasAllCapabilities('my-plugin', [
 *   'canReadMessages',
 *   'canSend',
 * ]);
 * ```
 */
export function hasAllCapabilities(
    pluginId: string,
    capabilities: string[]
): boolean {
    const plugin = registry.get(pluginId);
    if (!plugin || !plugin.capabilities) return false;
    return capabilities.every((cap) => plugin.capabilities!.includes(cap));
}

/**
 * Purpose:
 * Validate that a plugin declares at least one of the listed capabilities.
 *
 * Behavior:
 * Returns true when any capability is present.
 *
 * Constraints:
 * - Returns false when the plugin is missing
 *
 * Non-Goals:
 * - Authorization enforcement
 *
 * @example
 * ```ts
 * const ok = hasAnyCapability('my-plugin', ['canWriteDocs', 'canSend']);
 * ```
 */
export function hasAnyCapability(
    pluginId: string,
    capabilities: string[]
): boolean {
    const plugin = registry.get(pluginId);
    if (!plugin || !plugin.capabilities) return false;
    return capabilities.some((cap) => plugin.capabilities!.includes(cap));
}
