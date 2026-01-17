/**
 * Dashboard Navigation Adapter
 *
 * Wraps dashboard navigation with component caching and error handling.
 */

import {
    useDashboardNavigation,
    resolveDashboardPluginPageComponent,
} from '~/composables/dashboard/useDashboardPlugins';
import type { DashboardNavigationAdapter } from '../client';

/**
 * Creates the dashboard navigation adapter.
 * Preserves component cache and error handling state.
 */
export function createDashboardNavigationAdapter(): DashboardNavigationAdapter {
    return {
        navigate: async (pluginId: string, pageId?: string) => {
            const nav = useDashboardNavigation();
            if (pageId) {
                await nav.openPage(pluginId, pageId);
            } else {
                await nav.openPlugin(pluginId);
            }
        },

        resolveComponent: resolveDashboardPluginPageComponent,
        useNavigation: useDashboardNavigation,
    };
}
