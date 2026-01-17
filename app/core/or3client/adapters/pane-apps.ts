/**
 * Pane Apps Adapter
 *
 * Wraps the pane apps registry with Zod validation.
 */

import { computed, type ComputedRef } from 'vue';
import {
    usePaneApps,
    type PaneAppDef,
    type RegisteredPaneApp,
} from '~/composables/core/usePaneApps';
import type { PaneAppsAdapter } from '../client';

/**
 * Creates the pane apps adapter.
 * Preserves Zod validation, async factories, and ordering.
 */
export function createPaneAppsAdapter(): PaneAppsAdapter {
    const api = usePaneApps();

    return {
        register: api.registerPaneApp,
        unregister: api.unregisterPaneApp,
        get: api.getPaneApp,
        list: () => api.listPaneApps.value.slice(),
        useItems: () => api.listPaneApps as ComputedRef<readonly RegisteredPaneApp[]>,
        listIds: () => api.listPaneApps.value.map((a) => a.id),
    };
}
