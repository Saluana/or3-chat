/**
 * @module app/composables/sidebar/useSidebarPages
 *
 * Purpose:
 * Defines the sidebar page registry and validation layer for sidebar pages.
 *
 * Responsibilities:
 * - Validates page definitions
 * - Wraps async components for safe loading
 * - Provides a reactive list of registered pages
 *
 * Non-responsibilities:
 * - Does not manage active page state
 * - Does not render sidebar UI
 */
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
 * `SidebarPageDef`
 *
 * Purpose:
 * Defines the public contract for a sidebar page registration.
 *
 * Behavior:
 * Captures metadata, component definitions, and lifecycle hooks for pages.
 *
 * Constraints:
 * - `id` must be lowercase and unique in the registry
 *
 * Non-Goals:
 * - Does not define how pages are rendered or routed
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
 * `SidebarPageContext`
 *
 * Purpose:
 * Provides a registration-time context for sidebar pages to expose APIs.
 *
 * Behavior:
 * Exposes the page definition and an `expose` helper to publish APIs.
 *
 * Constraints:
 * - Intended to be used during registration
 *
 * Non-Goals:
 * - Does not manage page activation state
 */
export interface SidebarPageContext {
    /** The page definition for this context */
    page: SidebarPageDef;
    /** Function to expose APIs to other parts of the application */
    expose: (api: Record<string, unknown>) => void;
}

/**
 * `SidebarActivateContext`
 *
 * Purpose:
 * Provides activation-time context for sidebar pages.
 *
 * Behavior:
 * Supplies the active page, previous page, and supporting API access.
 *
 * Constraints:
 * - Provided only during activation/deactivation hooks
 *
 * Non-Goals:
 * - Does not allow registration-time mutations
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
 * `RegisteredSidebarPage`
 *
 * Purpose:
 * Represents a normalized, registry-ready sidebar page definition.
 *
 * Behavior:
 * Mirrors `SidebarPageDef` but with the component normalized for rendering.
 *
 * Constraints:
 * - Produced by the registry normalization process
 *
 * Non-Goals:
 * - Does not alter the external page contract
 */
export type RegisteredSidebarPage = SidebarPageDef;

/**
 * Sidebar page definition schema.
 *
 * Purpose:
 * Validates sidebar page definitions before they enter the registry.
 *
 * Behavior:
 * Enforces required fields and basic constraints (id format, label length).
 *
 * Constraints:
 * - Does not validate Vue component shape at runtime
 *
 * Non-Goals:
 * - Does not enforce business-specific rules beyond schema constraints
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
 *
 * Supports test isolation by creating the registry on-demand.
 *
 * @returns The global Map registry for sidebar pages.
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
 *
 * Distinguishes between raw async loaders (e.g., `() => import('./Comp.vue')`)
 * and functions produced by `defineComponent` which expose `setup`/`render`.
 *
 * @param component - The component to check.
 * @returns True if the component is an async loader function.
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
 *
 * Converts async component loaders to Vue's defineAsyncComponent with error handling.
 *
 * @param def - The raw page definition to normalize.
 * @returns A normalized RegisteredSidebarPage with wrapped component and defaults.
 */
function normalizeSidebarPageDef(def: SidebarPageDef): RegisteredSidebarPage {
    const normalized: RegisteredSidebarPage = {
        ...def,
        component: markRaw(
            isAsyncComponentLoader(def.component)
                ? defineAsyncComponent({
                      loader: def.component,
                      timeout: 15000,
                      suspensible: false,
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
 * `useSidebarPages`
 *
 * Purpose:
 * Provides registry access for registering and listing sidebar pages.
 *
 * Behavior:
 * Validates page definitions, normalizes components, and exposes a reactive list.
 *
 * Constraints:
 * - Registration is client-only
 * - Uses a global registry that persists across component lifecycles
 *
 * Non-Goals:
 * - Does not manage the active page selection
 */
export function useSidebarPages() {
    /**
     * `registerSidebarPage`
     *
     * Purpose:
     * Registers a sidebar page definition in the global registry.
     *
     * Behavior:
     * Validates and normalizes the page definition, then stores it. Returns an
     * unregister callback for cleanup.
     *
     * Constraints:
     * - No-op on the server
     * - Throws when the definition fails schema validation
     *
     * Non-Goals:
     * - Does not resolve activation or routing
     *
     * @throws Error when validation fails.
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
     * `unregisterSidebarPage`
     *
     * Purpose:
     * Removes a sidebar page from the registry.
     *
     * Behavior:
     * Deletes the page and updates reactive consumers.
     *
     * Constraints:
     * - No-op when the ID is not registered
     *
     * Non-Goals:
     * - Does not run page-specific teardown
     */
    function unregisterSidebarPage(id: string): void {
        const registry = getRegistry();
        if (registry.delete(id)) {
            // Trigger reactivity
            state.version++;
        }
    }

    /**
     * `getSidebarPage`
     *
     * Purpose:
     * Retrieves a registered sidebar page by ID.
     *
     * Behavior:
     * Returns the normalized page definition or undefined.
     *
     * Constraints:
     * - Uses the global registry
     *
     * Non-Goals:
     * - Does not validate the page ID format
     */
    function getSidebarPage(id: string): RegisteredSidebarPage | undefined {
        return getRegistry().get(id);
    }

    /**
     * `listSidebarPages`
     *
     * Purpose:
     * Provides a reactive list of registered pages sorted by order.
     *
     * Behavior:
     * Updates when pages are registered or unregistered.
     *
     * Constraints:
     * - Uses DEFAULT_ORDER when order is omitted
     *
     * Non-Goals:
     * - Does not filter by visibility or permissions
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
