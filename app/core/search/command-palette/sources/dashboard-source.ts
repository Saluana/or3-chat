import {
    listDashboardPluginPages,
    useDashboardPlugins,
    type DashboardPlugin,
    type DashboardPluginPage,
} from '~/composables/dashboard/useDashboardPlugins';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteCategory,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';

const SETTINGS_PLUGIN_IDS = new Set([
    'settings',
    'or3-settings',
    'core-settings',
    'core:settings',
]);

function isSettingsPlugin(plugin: DashboardPlugin): boolean {
    if (SETTINGS_PLUGIN_IDS.has(plugin.id)) return true;
    return (plugin.capabilities ?? []).includes('canAccessSettings');
}

function categoryForPlugin(plugin: DashboardPlugin): PaletteCategory {
    if (isSettingsPlugin(plugin)) {
        return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'setting')!;
    }
    return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'dashboard')!;
}

/**
 * Dashboard + settings source. Observes the live dashboard registry on each load.
 */
export function createDashboardPaletteSource(): PaletteSearchSource {
    return {
        id: 'dashboard',
        label: 'Dashboard',
        category: CORE_PALETTE_CATEGORIES.find((c) => c.id === 'dashboard')!,
        order: 80,
        async load(context) {
            context.signal?.throwIfAborted();
            return collectDashboardResources();
        },
    };
}

export function collectDashboardResources(): PaletteResource[] {
    const plugins = useDashboardPlugins().value;
    const resources: PaletteResource[] = [];

    for (const plugin of plugins) {
        const ownerPluginId = plugin.pluginId ?? plugin.id;
        if (!getPluginGateDecision(ownerPluginId, plugin.access).allowed) continue;
        const category = categoryForPlugin(plugin);
        resources.push(pluginToResource(plugin, category));

        const pages = listDashboardPluginPages(plugin.id);
        for (const page of pages) {
            if (
                !getPluginGateDecision(ownerPluginId, page.access ?? plugin.access)
                    .allowed
            ) {
                continue;
            }
            resources.push(pageToResource(plugin, page, category));
        }
    }
    return resources;
}

function pluginToResource(
    plugin: DashboardPlugin,
    category: PaletteCategory
): PaletteResource {
    return {
        key: `dashboard:${plugin.id}`,
        sourceId: 'dashboard',
        categoryId: category.id,
        recordId: plugin.id,
        title: plugin.label,
        subtitle: plugin.description,
        content: [plugin.label, plugin.description, ...(plugin.capabilities ?? [])]
            .filter(Boolean)
            .join(' '),
        keywords: plugin.capabilities,
        icon: plugin.icon,
        updatedAt: 0,
        primaryAction: {
            id: `dashboard:open:${plugin.id}`,
            label: 'Open',
            target: { kind: 'dashboard', pluginId: plugin.id },
        },
        secondaryActions: [],
        metadata: {
            pluginId: plugin.id,
        },
    };
}

function pageToResource(
    plugin: DashboardPlugin,
    page: DashboardPluginPage,
    category: PaletteCategory
): PaletteResource {
    return {
        key: `dashboard:${plugin.id}:${page.id}`,
        sourceId: 'dashboard',
        categoryId: category.id,
        recordId: `${plugin.id}/${page.id}`,
        title: page.title,
        subtitle: plugin.label,
        content: [page.title, page.description, plugin.label]
            .filter(Boolean)
            .join(' '),
        icon: page.icon ?? plugin.icon,
        updatedAt: 0,
        primaryAction: {
            id: `dashboard:open:${plugin.id}:${page.id}`,
            label: 'Open',
            target: {
                kind: 'dashboard',
                pluginId: plugin.id,
                pageId: page.id,
            },
        },
        secondaryActions: [],
        metadata: {
            pluginId: plugin.id,
            pageId: page.id,
        },
    };
}
