/**
 * Sidebar Footer Actions Adapter
 *
 * Wraps the sidebar footer actions registry with context-aware filtering.
 */

import { type ComputedRef, computed } from 'vue';
import {
    registerSidebarFooterAction,
    unregisterSidebarFooterAction,
    useSidebarFooterActions,
    listRegisteredSidebarFooterActionIds,
    type SidebarFooterAction,
    type SidebarFooterActionContext,
    type SidebarFooterActionEntry,
} from '~/composables/sidebar/useSidebarSections';
import type { SidebarFooterActionsAdapter } from '../client';

/**
 * Creates the sidebar footer actions adapter.
 * Preserves context-aware filtering and disabled state computation.
 */
export function createSidebarFooterActionsAdapter(): SidebarFooterActionsAdapter {
    // Get all actions (no context) for get/list
    const allActions = useSidebarFooterActions();

    return {
        register: registerSidebarFooterAction,
        unregister: unregisterSidebarFooterAction,
        get: (id) => allActions.value.find((e) => e.action.id === id)?.action,
        list: () => allActions.value.map((e) => e.action),
        listIds: listRegisteredSidebarFooterActionIds,

        // Reactive list with context-aware disabled state
        useItems: (context = () => ({})) => useSidebarFooterActions(context),
    };
}
