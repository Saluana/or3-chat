/**
 * Dashboard Pages Adapter
 *
 * Wraps the dashboard plugin pages registry.
 * Supports per-plugin page registration.
 */

import { computed, type ComputedRef } from 'vue';
import {
    registerDashboardPluginPage,
    unregisterDashboardPluginPage,
    useDashboardPluginPages,
    listDashboardPluginPages,
    getDashboardPluginPage,
    type DashboardPluginPage,
} from '~/composables/dashboard/useDashboardPlugins';
import type { DashboardPagesAdapter } from '../client';

/**
 * Creates the dashboard pages adapter.
 * Supports per-plugin page management.
 */
export function createDashboardPagesAdapter(): DashboardPagesAdapter {
    return {
        register: (pluginId: string, page: DashboardPluginPage) =>
            registerDashboardPluginPage(pluginId, page),

        unregister: (pluginId: string, pageId?: string) =>
            unregisterDashboardPluginPage(pluginId, pageId),

        get: getDashboardPluginPage,
        list: listDashboardPluginPages,

        useItems: (pluginId: () => string | undefined) =>
            useDashboardPluginPages(pluginId),
    };
}
