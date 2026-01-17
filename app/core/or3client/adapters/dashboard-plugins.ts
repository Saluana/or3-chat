/**
 * Dashboard Plugins Adapter
 *
 * Wraps the dashboard plugins registry.
 */

import { computed } from 'vue';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    useDashboardPlugins,
    listRegisteredDashboardPluginIds,
    type DashboardPlugin,
} from '~/composables/dashboard/useDashboardPlugins';
import type { RegistryAdapter } from '../utils';

/**
 * Creates the dashboard plugins adapter.
 * Preserves inline page normalization.
 */
export function createDashboardPluginsAdapter(): RegistryAdapter<DashboardPlugin> {
    const plugins = useDashboardPlugins();

    return {
        register: registerDashboardPlugin,
        unregister: unregisterDashboardPlugin,
        get: (id) => plugins.value.find((p) => p.id === id),
        list: () => [...plugins.value],
        useItems: () => plugins,
        listIds: listRegisteredDashboardPluginIds,
    };
}
