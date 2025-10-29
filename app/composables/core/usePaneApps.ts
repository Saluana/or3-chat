import {
    computed,
    reactive,
    markRaw,
    type Component,
    type ComputedRef,
} from 'vue';

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
    component: Component | (() => Promise<any>);

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

// Global registry storage
const g: any = globalThis as any;
const registry: Map<string, RegisteredPaneApp> =
    g.__or3PaneAppsRegistry || (g.__or3PaneAppsRegistry = new Map());

// Reactive wrapper to trigger Vue reactivity on changes
const reactiveRegistry = reactive<{ version: number }>({ version: 0 });

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
        // Trigger reactivity by bumping version
        reactiveRegistry.version++;
    }

    /**
     * Unregister a pane app by id.
     */
    function unregisterPaneApp(id: string): void {
        registry.delete(id);
        // Trigger reactivity
        reactiveRegistry.version++;
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
        // Access version to make computed depend on registry changes
        reactiveRegistry.version;
        const apps = Array.from(registry.values());
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
