import { reactive, computed } from 'vue';

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
}

// Global singleton (survives HMR)
const g: any = globalThis as any;
const registry: Map<string, DashboardPlugin> =
    g.__or3DashboardPluginsRegistry ||
    (g.__or3DashboardPluginsRegistry = new Map());

// Reactive projection for consumers
const reactiveList = reactive<{ items: DashboardPlugin[] }>({ items: [] });

function sync() {
    reactiveList.items = Array.from(registry.values());
}

export function registerDashboardPlugin(plugin: DashboardPlugin) {
    registry.set(plugin.id, plugin);
    sync();
}

export function unregisterDashboardPlugin(id: string) {
    if (registry.delete(id)) sync();
}

export function useDashboardPlugins() {
    return computed(() =>
        reactiveList.items.sort((a, b) => (a.order ?? 200) - (b.order ?? 200))
    );
}

export function listRegisteredDashboardPluginIds(): string[] {
    return Array.from(registry.keys());
}

// Minimal built‑in examples can be registered in a plugin file separately; keeping
// this composable focused only on registry mechanics (mirrors other ui-extension patterns).
