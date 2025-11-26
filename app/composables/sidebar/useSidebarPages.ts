import {
    computed,
    defineAsyncComponent,
    markRaw,
    reactive,
    type Component,
    type ComputedRef,
} from 'vue';
import { z } from 'zod';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

/**
 * Definition interface for a sidebar page.
 * Defines the structure and behavior of pages that can be registered in the sidebar.
 */
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
    component: Component | (() => Promise<Component>);
    /** Opt-in caching for the component */
    keepAlive?: boolean;
    /** Whether this page uses the default header. Defaults to true for home page */
    usesDefaultHeader?: boolean;
    /** Optional context provider for the page */
    provideContext?: (ctx: SidebarPageContext) => void;
    /** Optional activation guard - return false to prevent activation */
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>;
    /** Optional activation hook called when page becomes active */
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    /** Optional deactivation hook called when page becomes inactive */
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
}

/**
 * Context object provided to sidebar pages during registration and lifecycle events.
 */
export interface SidebarPageContext {
    /** The page definition for this context */
    page: SidebarPageDef;
    /** Function to expose APIs to other parts of the application */
    expose: (api: Record<string, unknown>) => void;
}

/**
 * Context object provided to sidebar pages during activation and deactivation events.
 * Contains information about the current state and access to system APIs.
 */
export interface SidebarActivateContext {
    /** The page being activated/deactivated */
    page: SidebarPageDef;
    /** The previously active page, or null if this is the first activation */
    previousPage: SidebarPageDef | null;
    /** Whether the sidebar is currently collapsed */
    isCollapsed: boolean;
    /** API for managing panes in the multi-pane system */
    multiPane: UseMultiPaneApi;
    /** API for pane plugin operations */
    panePluginApi: PanePluginApi;
}

/**
 * Type alias for registered sidebar pages.
 * RegisteredSidebarPage is exactly SidebarPageDef semantically (component already wrapped).
 */
export type RegisteredSidebarPage = SidebarPageDef;

/**
 * Zod schema for validating sidebar page definitions at registration.
 * Enforces constraints like id format, label length, and required fields.
 * 
 * Validation rules:
 * - id: Lowercase alphanumeric with hyphens, minimum 1 character
 * - label: Required string, maximum 100 characters
 * - icon: Required string
 * - order: Optional integer between 0 and 1000
 * - component: Any (Vue component shape cannot be strictly validated at runtime)
 */
const SidebarPageDefSchema = z.object({
    id: z
        .string()
        .min(1, 'Page id is required')
        .regex(
            /^[a-z0-9-]+$/,
            'Page id must be lowercase alphanumeric with hyphens'
        ),
    label: z
        .string()
        .min(1, 'Label is required')
        .max(100, 'Label must be 100 characters or less'),
    icon: z.string().min(1, 'Icon is required'),
    order: z
        .number()
        .int()
        .min(0)
        .max(1000, 'Order must be between 0 and 1000')
        .optional(),
    component: z.any(), // Cannot strictly validate Vue component shape at runtime
    keepAlive: z.boolean().optional(),
    usesDefaultHeader: z.boolean().optional(),
    provideContext: z.function().optional(),
    canActivate: z.function().optional(),
    onActivate: z.function().optional(),
    onDeactivate: z.function().optional(),
});

/**
 * Helper to get the global registry instance.
 * Supports test isolation by creating the registry on-demand.
 * 
 * @returns The global Map registry for sidebar pages
 */
function getRegistry(): Map<string, RegisteredSidebarPage> {
    const g = globalThis as {
        __or3SidebarPagesRegistry?: Map<string, RegisteredSidebarPage>;
    };
    if (!g.__or3SidebarPagesRegistry) {
        g.__or3SidebarPagesRegistry = new Map();
    }
    return g.__or3SidebarPagesRegistry;
}

/**
 * Reactive state version tracker.
 * Incrementing this version triggers reactivity in computed properties.
 */
const state = reactive({ version: 0 });

/**
 * Default order value for pages that don't specify an order.
 */
const DEFAULT_ORDER = 200;

/**
 * Type guard to check if a component is an async component loader function.
 * Distinguishes between raw async loaders (e.g., `() => import('./Comp.vue')`) 
 * and functions produced by `defineComponent` which expose `setup`/`render`.
 * 
 * @param component - The component to check
 * @returns True if the component is an async loader function
 */
function isAsyncComponentLoader(
    component: SidebarPageDef['component']
): component is () => Promise<Component> {
    if (typeof component !== 'function') return false;
    const candidate = component as unknown;
    // Functions produced by `defineComponent` expose `setup`/`render`.
    // Raw async loaders (e.g. `() => import('./Comp.vue')`) have none of these hints.
    return (
        !(candidate as { setup?: unknown }).setup &&
        !(candidate as { render?: unknown }).render &&
        !(candidate as { __asyncLoader?: unknown }).__asyncLoader
    );
}

/**
 * Normalizes a sidebar page definition by wrapping components and setting defaults.
 * Converts async component loaders to Vue's defineAsyncComponent with error handling.
 * 
 * @param def - The raw page definition to normalize
 * @returns A normalized RegisteredSidebarPage with wrapped component and defaults
 */
function normalizeSidebarPageDef(def: SidebarPageDef): RegisteredSidebarPage {
    const normalized: RegisteredSidebarPage = {
        ...def,
        component: markRaw(
            isAsyncComponentLoader(def.component)
                ? defineAsyncComponent({
                      loader: def.component,
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
 * Provides reactive access to the list of registered pages.
 * 
 * @returns Object containing page management functions and reactive page list
 */
export function useSidebarPages() {
    /**
     * Register a new sidebar page. If a page with the same id exists, it is replaced.
     * Validates the definition and wraps components appropriately.
     * 
     * @param def - The page definition to register
     * @returns Unregister function for cleanup
     * @throws Error if the page definition is invalid
     */
    function registerSidebarPage(def: SidebarPageDef): () => void {
        if (!process.client) {
            // Return no-op on server side
            return () => {};
        }

        // Validate input with Zod schema
        const parsed = SidebarPageDefSchema.safeParse(def);
        if (!parsed.success) {
            console.error('[useSidebarPages] Invalid definition', parsed.error);
            throw new Error(
                parsed.error.issues[0]?.message ??
                    'Invalid sidebar page definition'
            );
        }

        const normalized = normalizeSidebarPageDef(def);
        const registry = getRegistry();

        if (import.meta.dev && registry.has(def.id)) {
            console.warn(
                `[useSidebarPages] Replacing existing page id: ${def.id}`
            );
        }

        registry.set(def.id, normalized);
        // Trigger reactivity
        state.version++;

        // Return unregister function
        return () => {
            const reg = getRegistry();
            if (reg.get(def.id) === normalized) {
                reg.delete(def.id);
                state.version++;
            }
        };
    }

    /**
     * Unregister a sidebar page by id.
     * Removes the page from the global registry and triggers reactivity.
     * 
     * @param id - The ID of the page to unregister
     */
    function unregisterSidebarPage(id: string): void {
        const registry = getRegistry();
        if (registry.delete(id)) {
            // Trigger reactivity
            state.version++;
        }
    }

    /**
     * Get a registered sidebar page by id.
     * 
     * @param id - The ID of the page to retrieve
     * @returns The registered page definition, or undefined if not found
     */
    function getSidebarPage(id: string): RegisteredSidebarPage | undefined {
        return getRegistry().get(id);
    }

    /**
     * Reactive computed property listing all registered sidebar pages.
     * Pages are sorted by order (ascending), with unsorted pages using DEFAULT_ORDER.
     * Automatically updates when pages are registered or unregistered.
     * 
     * @returns ComputedRef containing sorted array of registered pages
     */
    const listSidebarPages: ComputedRef<RegisteredSidebarPage[]> = computed(
        () => {
            // Access state.version to establish dependency
            void state.version;
            const registry = getRegistry();
            const pages = Array.from(registry.values());
            return pages.sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            );
        }
    );

    return {
        /** Register a new sidebar page */
        registerSidebarPage,
        /** Unregister a sidebar page by ID */
        unregisterSidebarPage,
        /** Get a specific registered page */
        getSidebarPage,
        /** Reactive list of all registered pages, sorted by order */
        listSidebarPages,
    };
}
