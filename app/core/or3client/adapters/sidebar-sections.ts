/**
 * Sidebar Sections Adapter
 *
 * Wraps the sidebar sections registry with grouped output (top/main/bottom).
 */

import { computed, type ComputedRef } from 'vue';
import {
    registerSidebarSection,
    unregisterSidebarSection,
    useSidebarSections,
    listRegisteredSidebarSectionIds,
    type SidebarSection,
    type SidebarSectionGroups,
} from '~/composables/sidebar/useSidebarSections';
import type { SidebarSectionsAdapter } from '../client';

/**
 * Creates the sidebar sections adapter.
 * Preserves grouped output (top/main/bottom) for UI layout.
 */
export function createSidebarSectionsAdapter(): SidebarSectionsAdapter {
    const grouped = useSidebarSections();

    return {
        register: registerSidebarSection,
        unregister: unregisterSidebarSection,
        get: (id) => {
            // Search across all groups
            const all = [
                ...grouped.value.top,
                ...grouped.value.main,
                ...grouped.value.bottom,
            ];
            return all.find((s) => s.id === id);
        },
        list: () => {
            return [
                ...grouped.value.top,
                ...grouped.value.main,
                ...grouped.value.bottom,
            ];
        },
        listIds: listRegisteredSidebarSectionIds,

        // Reactive grouped output (top/main/bottom)
        useGrouped: () => grouped,

        // Reactive flat list
        useItems: () =>
            computed(() => [
                ...grouped.value.top,
                ...grouped.value.main,
                ...grouped.value.bottom,
            ]),
    };
}
