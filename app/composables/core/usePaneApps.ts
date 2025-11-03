import {
    computed,
    reactive,
    markRaw,
    type Component,
    type ComputedRef,
} from 'vue';
import { z } from 'zod';

/**
 * Pane app definition: describes a custom pane application that can be registered
 * and opened in the multi-pane workspace.
 */
export interface PaneAppDef {
    /** Unique identifier for the pane app (used as the pane mode when opened). */
    id: string;

    /** Display label shown in UI (e.g., sidebar). */
    label: string;

    /** Optional Iconify icon name. */
    icon?: string;

    /** Vue component or async component factory. */
    component: Component | (() => Promise<Component>);

    /**
     * Optional override for the postType stored in the posts table.
     * If not provided, defaults to the app id.
     */
    postType?: string;

    /**
     * Optional callback to create an initial record when a new pane is opened.
     * Return { id } to assign as the pane's documentId, or null for no record.
     */
    createInitialRecord?: (ctx: {
        app: PaneAppDef;
    }) => Promise<{ id: string } | null>;

    /**
     * Optional ordering (lower = earlier in sorted lists). Defaults to 200.
     */
    order?: number;
}

export interface RegisteredPaneApp extends PaneAppDef {
    // PaneAppDef fields, component already wrapped
}

/**
 * Zod schema for validating pane app definitions at registration.
 * Enforces constraints like id format, label length, and order bounds.
 */
const PaneAppDefSchema = z.object({
    id: z
        .string()
        .min(1, 'App id is required')
        .regex(
            /^[a-z0-9-]+$/,
            'App id must be lowercase alphanumeric with hyphens'
        ),
    label: z
        .string()
        .min(1, 'Label is required')
        .max(100, 'Label must be 100 characters or less'),
    icon: z.string().optional(),
    component: z.any(), // Cannot strictly validate Vue component shape at runtime
    order: z
        .number()
        .int()
        .min(0)
        .max(1000, 'Order must be between 0 and 1000')
        .optional(),
    postType: z.string().optional(),
    createInitialRecord: z.function().optional(),
});

// Global registry storage
const registry: Map<string, RegisteredPaneApp> = (() => {
    const g = globalThis as {
        __or3PaneAppsRegistry?: Map<string, RegisteredPaneApp>;
    };
    if (!g.__or3PaneAppsRegistry) {
        g.__or3PaneAppsRegistry = new Map();
    }
    return g.__or3PaneAppsRegistry;
})();

// Reactive wrapper - we track the registry itself so Vue can react to map changes
const reactiveRegistry = reactive({ registry });

const DEFAULT_ORDER = 200;

/**
 * Composable to register and manage custom pane applications.
 * Uses a global Map so plugins can register pane apps that persist across component lifecycles.
 */
export function usePaneApps() {
    /**
     * Register a new pane app. If an app with the same id exists, it is replaced.
     */
    function registerPaneApp(def: PaneAppDef): void {
        // Validate input with Zod schema
        const parsed = PaneAppDefSchema.safeParse(def);
        if (!parsed.success) {
            console.error('[usePaneApps] Invalid definition', parsed.error);
            throw new Error(
                parsed.error.issues[0]?.message ?? 'Invalid pane app definition'
            );
        }

        const normalized: RegisteredPaneApp = {
            ...def,
            component: markRaw(
                typeof def.component === 'function'
                    ? def.component
                    : markRaw(def.component)
            ),
            order: def.order ?? DEFAULT_ORDER,
        };
        registry.set(def.id, normalized);
        // Trigger reactivity by mutating the reactive wrapper
        reactiveRegistry.registry = new Map(registry);
    }

    /**
     * Unregister a pane app by id.
     */
    function unregisterPaneApp(id: string): void {
        registry.delete(id);
        // Trigger reactivity
        reactiveRegistry.registry = new Map(registry);
    }

    /**
     * Get a registered pane app by id.
     */
    function getPaneApp(id: string): RegisteredPaneApp | undefined {
        return registry.get(id);
    }

    /**
     * List all registered pane apps, sorted by order (ascending).
     */
    const listPaneApps: ComputedRef<RegisteredPaneApp[]> = computed(() => {
        // Access reactive registry to establish dependency
        const currentRegistry = reactiveRegistry.registry;
        const apps = Array.from(currentRegistry.values());
        return apps.sort(
            (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
        );
    });

    return {
        registerPaneApp,
        unregisterPaneApp,
        getPaneApp,
        listPaneApps,
    };
}
