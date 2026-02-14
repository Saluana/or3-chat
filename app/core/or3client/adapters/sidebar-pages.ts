/**
 * Sidebar Pages Adapter
 *
 * Wraps the sidebar pages registry preserving:
 * - Zod validation
 * - Async component wrapping with retry + timeout
 * - SSR no-op registration
 * - Lifecycle hooks (provideContext, canActivate, onActivate, onDeactivate)
 */

import { computed, type ComputedRef } from 'vue';
import {
    useSidebarPages,
    type SidebarPageDef,
    type RegisteredSidebarPage,
} from '~/composables/sidebar/useSidebarPages';
import type { SidebarPagesAdapter } from '../client';

/**
 * Creates a no-op implementation for SSR.
 */
function createNoOpSidebarPagesAdapter(): SidebarPagesAdapter {
    return {
        register: () => () => {},
        unregister: () => {},
        get: () => undefined,
        list: () => [],
        useItems: () => computed(() => []),
        listIds: () => [],
    };
}

/**
 * Creates the sidebar pages adapter.
 * Returns no-op on SSR, real adapter on client.
 */
export function createSidebarPagesAdapter(): SidebarPagesAdapter {
    // SSR: return no-op adapter
    if (import.meta.server) {
        return createNoOpSidebarPagesAdapter();
    }
    
    // Client: create real adapter
    const api = useSidebarPages();

    return {
        // Register returns an unregister function for cleanup
        register: (def: SidebarPageDef) => api.registerSidebarPage(def),
        unregister: api.unregisterSidebarPage,
        get: api.getSidebarPage,
        list: () => api.listSidebarPages.value.slice(),
        useItems: () => api.listSidebarPages as ComputedRef<readonly RegisteredSidebarPage[]>,
        listIds: () => api.listSidebarPages.value.map((p) => p.id),
    };
}
