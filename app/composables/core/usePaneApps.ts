import {
    computed,
    defineAsyncComponent,
    reactive,
    markRaw,
    type Component,
    type ComputedRef,
} from 'vue';
import { z } from 'zod';
import {
    createRegistrationHandle,
    type RegistrationHandle,
} from '~~/shared/plugins/registration-handle';
import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';
import { getContributionSurfaceKernel } from '~/composables/plugins/contribution-surface-kernel';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

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
    /** Optional owning plugin id used for workspace policy lookup. */
    pluginId?: string;
    /** Optional access policy for this pane app. */
    access?: PluginGatePolicy;
    /** Replace this app's record in the current workspace tab. */
    replaceRecordInCurrentTab?: boolean;
}

// RegisteredPaneApp is exactly PaneAppDef, but semantically represents a validated/normalized entry
export type RegisteredPaneApp = PaneAppDef;

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
    pluginId: z.string().optional(),
    access: z.unknown().optional(),
    replaceRecordInCurrentTab: z.boolean().optional(),
});

type OwnedPaneApp = {
    app: RegisteredPaneApp;
    owner: symbol;
};

// Global registry storage
const ownedRegistry: Map<string, OwnedPaneApp> = (() => {
    const g = globalThis as {
        __or3PaneAppsOwnedRegistry?: Map<string, OwnedPaneApp>;
    };
    if (!g.__or3PaneAppsOwnedRegistry) {
        g.__or3PaneAppsOwnedRegistry = new Map();
    }
    return g.__or3PaneAppsOwnedRegistry;
})();

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

function isAsyncComponentLoader(
    component: PaneAppDef['component']
): component is () => Promise<Component> {
    if (typeof component !== 'function') return false;
    const candidate = component as {
        setup?: unknown;
        render?: unknown;
        __asyncLoader?: unknown;
    };
    return (
        !candidate.setup &&
        !candidate.render &&
        !candidate.__asyncLoader
    );
}

function normalizePaneApp(def: PaneAppDef): RegisteredPaneApp {
    return {
        ...def,
        component: markRaw(
            isAsyncComponentLoader(def.component)
                ? defineAsyncComponent({
                      loader: def.component,
                      timeout: 15000,
                      suspensible: false,
                      onError(_error, retry, fail, attempts) {
                          if (attempts <= 2) retry();
                          else fail();
                      },
                  })
                : markRaw(def.component)
        ),
        order: def.order ?? DEFAULT_ORDER,
    };
}

const v2Kernel = getContributionSurfaceKernel<RegisteredPaneApp>('pane-apps', {
    getId: (app) => app.id,
    normalize: normalizePaneApp,
    // Pane apps preserve registration order when order values tie.
    compare: (left, right) =>
        (left.order ?? DEFAULT_ORDER) - (right.order ?? DEFAULT_ORDER),
});

function useV2Surface(): boolean {
    return getContributionSurfaceSelection().isSelected('pane-apps');
}

/**
 * `usePaneApps`
 *
 * Purpose:
 * Registers and manages custom pane applications.
 *
 * Behavior:
 * Stores definitions in a global Map so plugins can register pane apps that
 * persist across component lifecycles and HMR.
 *
 * Constraints:
 * - Pane app ids must be lowercase and hyphenated
 * - Uses Zod validation and throws on invalid definitions
 *
 * Non-Goals:
 * - Does not lazy load or render apps itself
 * - Access policies affect discovery and lookup, not server-side authorization
 *
 * @example
 * ```ts
 * const { registerPaneApp } = usePaneApps();
 * registerPaneApp({
 *   id: 'notes',
 *   label: 'Notes',
 *   component: () => import('~/components/panes/NotesPane.vue'),
 * });
 * ```
 */
export function usePaneApps() {
    /**
     * Register a new pane app. If an app with the same id exists, it is replaced.
     */
    function registerPaneApp(def: PaneAppDef): RegistrationHandle {
        // Validate input with Zod schema
        const parsed = PaneAppDefSchema.safeParse(def);
        if (!parsed.success) {
            console.error('[usePaneApps] Invalid definition', parsed.error);
            throw new Error(
                parsed.error.issues[0]?.message ?? 'Invalid pane app definition'
            );
        }

        if (useV2Surface()) {
            return v2Kernel.registry.registerLegacy({ value: def });
        }

        const owner = Symbol(`pane-app:${def.id}`);
        const normalized = normalizePaneApp(def);
        ownedRegistry.set(def.id, { app: normalized, owner });
        registry.set(def.id, normalized);
        // Trigger reactivity by mutating the reactive wrapper
        reactiveRegistry.registry = new Map(registry);
        return createRegistrationHandle({
            id: def.id,
            owner,
            isCurrent: () => ownedRegistry.get(def.id)?.owner === owner,
            remove: () => {
                if (ownedRegistry.get(def.id)?.owner !== owner) return;
                ownedRegistry.delete(def.id);
                registry.delete(def.id);
                reactiveRegistry.registry = new Map(registry);
            },
        });
    }

    /**
     * Unregister a pane app by id.
     */
    function unregisterPaneApp(id: string): void {
        if (useV2Surface()) {
            v2Kernel.registry.unregisterLegacy(id);
            return;
        }
        ownedRegistry.delete(id);
        registry.delete(id);
        // Trigger reactivity
        reactiveRegistry.registry = new Map(registry);
    }

    /**
     * Get a registered pane app by id.
     */
    function getPaneApp(id: string): RegisteredPaneApp | undefined {
        const app = useV2Surface()
            ? v2Kernel.registry.get(id, undefined)
            : registry.get(id);
        return app && getPluginGateDecision(app.pluginId, app.access).allowed
            ? app
            : undefined;
    }

    /**
     * List all registered pane apps, sorted by order (ascending).
     */
    const listPaneApps: ComputedRef<RegisteredPaneApp[]> = computed(() => {
        if (useV2Surface()) {
            return v2Kernel.items.value.filter(
                (app) => getPluginGateDecision(app.pluginId, app.access).allowed
            );
        }
        // Access reactive registry to establish dependency
        const currentRegistry = reactiveRegistry.registry;
        const apps = Array.from(currentRegistry.values());
        return apps
            .filter(
                (app) => getPluginGateDecision(app.pluginId, app.access).allowed
            )
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            );
    });

    return {
        registerPaneApp,
        unregisterPaneApp,
        getPaneApp,
        listPaneApps,
    };
}
