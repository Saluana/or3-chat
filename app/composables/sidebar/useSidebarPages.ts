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
    /** Optional activation guard */
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>;
    /** Optional activation hook */
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    /** Optional deactivation hook */
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
}

export interface SidebarPageContext {
    page: SidebarPageDef;
    expose: (api: Record<string, unknown>) => void;
}

export interface SidebarActivateContext {
    page: SidebarPageDef;
    previousPage: SidebarPageDef | null;
    isCollapsed: boolean;
    multiPane: UseMultiPaneApi;
    panePluginApi: PanePluginApi;
}

export interface RegisteredSidebarPage extends SidebarPageDef {
    // SidebarPageDef fields, component already wrapped
}

/**
 * Zod schema for validating sidebar page definitions at registration.
 * Enforces constraints like id format, label length, and required fields.
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

// Helper to get the global registry (supports test isolation)
function getRegistry(): Map<string, RegisteredSidebarPage> {
    const g = globalThis as {
        __or3SidebarPagesRegistry?: Map<string, RegisteredSidebarPage>;
    };
    if (!g.__or3SidebarPagesRegistry) {
        g.__or3SidebarPagesRegistry = new Map();
    }
    return g.__or3SidebarPagesRegistry;
}

// Version tracker for reactivity
const state = reactive({ version: 0 });

const DEFAULT_ORDER = 200;

/**
 * Normalize a sidebar page definition, wrapping components with defineAsyncComponent if needed
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
 */
export function useSidebarPages() {
    /**
     * Register a new sidebar page. If a page with the same id exists, it is replaced.
     * Returns an unregister function for cleanup.
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
     */
    function getSidebarPage(id: string): RegisteredSidebarPage | undefined {
        return getRegistry().get(id);
    }

    /**
     * List all registered sidebar pages, sorted by order (ascending).
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
        registerSidebarPage,
        unregisterSidebarPage,
        getSidebarPage,
        listSidebarPages,
    };
}
