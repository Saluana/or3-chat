import {
    computed,
    defineAsyncComponent,
    markRaw,
    reactive,
    type Component,
    type ComputedRef,
} from 'vue';

export interface SidebarPageDef {
    /** Unique identifier for the sidebar page */
    id: string;
    /** Display label shown in UI (e.g., tooltips) */
    label: string;
    /** Iconify icon name */
    icon: string;
    /** Optional ordering (lower = earlier in sorted lists). Defaults to 200 */
    order?: number;
    /** Vue component or async component factory */
    component: Component | (() => Promise<any>);
    /** Opt-in caching for the component */
    keepAlive?: boolean;
    /** Whether this page uses the default header. Defaults to true for home page */
    usesDefaultHeader?: boolean;
    /** Optional context provider for the page */
    provideContext?: (ctx: SidebarPageContext) => void;
    /** Optional activation guard */
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>;
    /** Optional activation hook */
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    /** Optional deactivation hook */
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
}

export interface SidebarPageContext {
    page: SidebarPageDef;
    expose: (api: any) => void;
}

export interface SidebarActivateContext {
    page: SidebarPageDef;
    previousPage: SidebarPageDef | null;
    isCollapsed: boolean;
    multiPane: any; // Will be typed later when we create the adapter
    panePluginApi: any; // Will be typed later
}

export interface RegisteredSidebarPage extends SidebarPageDef {
    // SidebarPageDef fields, component already wrapped
}

// Global registry storage using the same pattern as other registries
const g: any = globalThis as any;
const registry: Map<string, RegisteredSidebarPage> =
    g.__or3SidebarPagesRegistry || (g.__or3SidebarPagesRegistry = new Map());

// Reactive wrapper to trigger Vue reactivity on changes
const reactiveRegistry = reactive<{ version: number }>({ version: 0 });

const DEFAULT_ORDER = 200;

/**
 * Normalize a sidebar page definition, wrapping components with defineAsyncComponent if needed
 */
function isAsyncComponentLoader(
    component: SidebarPageDef['component']
): component is () => Promise<any> {
    if (typeof component !== 'function') return false;
    const candidate = component as any;
    // Functions produced by `defineComponent` expose `setup`/`render`.
    // Raw async loaders (e.g. `() => import('./Comp.vue')`) have none of these hints.
    return !candidate.setup && !candidate.render && !candidate.__asyncLoader;
}

function normalizeSidebarPageDef(def: SidebarPageDef): RegisteredSidebarPage {
    const normalized: RegisteredSidebarPage = {
        ...def,
        component: markRaw(
            isAsyncComponentLoader(def.component)
                ? defineAsyncComponent({
                      loader: def.component as () => Promise<any>,
                      timeout: 15000,
                      suspensible: true,
                      onError(error, retry, fail, attempts) {
                          if (attempts <= 2) retry();
                          else fail();
                      },
                  })
                : markRaw(def.component)
        ),
        order: def.order ?? DEFAULT_ORDER,
        usesDefaultHeader: def.usesDefaultHeader ?? def.id === 'sidebar-home',
    };

    return normalized;
}

/**
 * Composable to register and manage sidebar pages.
 * Uses a global Map so plugins can register pages that persist across component lifecycles.
 */
export function useSidebarPages() {
    // Get fresh registry reference each time
    const g: any = globalThis as any;
    const registry: Map<string, RegisteredSidebarPage> =
        g.__or3SidebarPagesRegistry ||
        (g.__or3SidebarPagesRegistry = new Map());

    /**
     * Register a new sidebar page. If a page with the same id exists, it is replaced.
     * Returns an unregister function for cleanup.
     */
    function registerSidebarPage(def: SidebarPageDef): () => void {
        if (!process.client) {
            // Return no-op on server side
            return () => {};
        }

        const normalized = normalizeSidebarPageDef(def);

        if (import.meta.dev && registry.has(def.id)) {
            console.warn(
                `[useSidebarPages] Replacing existing page id: ${def.id}`
            );
        }

        registry.set(def.id, normalized);
        // Trigger reactivity by bumping version
        reactiveRegistry.version++;

        // Return unregister function
        return () => {
            if (registry.get(def.id) === normalized) {
                registry.delete(def.id);
                reactiveRegistry.version++;
            }
        };
    }

    /**
     * Unregister a sidebar page by id.
     */
    function unregisterSidebarPage(id: string): void {
        if (registry.delete(id)) {
            // Trigger reactivity
            reactiveRegistry.version++;
        }
    }

    /**
     * Get a registered sidebar page by id.
     */
    function getSidebarPage(id: string): RegisteredSidebarPage | undefined {
        return registry.get(id);
    }

    /**
     * List all registered sidebar pages, sorted by order (ascending).
     */
    const listSidebarPages: ComputedRef<RegisteredSidebarPage[]> = computed(
        () => {
            // Access version to make computed depend on registry changes
            reactiveRegistry.version;
            // Always read fresh from global registry
            const currentRegistry: Map<string, RegisteredSidebarPage> =
                (globalThis as any).__or3SidebarPagesRegistry || new Map();
            const pages = Array.from(
                currentRegistry.values()
            ) as RegisteredSidebarPage[];
            return pages.sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            );
        }
    );

    return {
        registerSidebarPage,
        unregisterSidebarPage,
        getSidebarPage,
        listSidebarPages,
    };
}
