/**
 * @module app/composables/sidebar/useSidebarPageControls
 *
 * Purpose:
 * Provides helper composables for accessing sidebar page controls via injection.
 *
 * Responsibilities:
 * - Exposes page control accessors and convenience helpers
 *
 * Non-responsibilities:
 * - Does not create or provide page control instances
 * - Does not manage page registration
 */
import { inject } from 'vue';
import {
    SidebarPageControlsKey,
    type SidebarPageControls,
} from './useSidebarEnvironment';

/**
 * `useSidebarPageControls`
 *
 * Purpose:
 * Retrieves sidebar page controls from Vue injection.
 *
 * Behavior:
 * Throws when controls are not provided.
 *
 * Constraints:
 * - Must be called inside a component tree that provided the controls
 *
 * Non-Goals:
 * - Does not supply defaults
 *
 * @throws Error when used outside of a provider.
 */
export function useSidebarPageControls(): SidebarPageControls {
    const controls = inject(SidebarPageControlsKey);
    if (!controls) {
        throw new Error(
            'useSidebarPageControls must be used within a component that provides SidebarPageControls'
        );
    }
    return controls;
}

/**
 * `useIsActivePage`
 *
 * Purpose:
 * Checks whether a page ID matches the currently active page.
 *
 * Behavior:
 * Compares the provided ID against the injected controls state.
 *
 * Constraints:
 * - Requires available sidebar page controls
 *
 * Non-Goals:
 * - Does not trigger any navigation
 */
export function useIsActivePage(pageId: string): boolean {
    const { pageId: activePageId } = useSidebarPageControls();
    return activePageId === pageId;
}

/**
 * `useActivePageId`
 *
 * Purpose:
 * Returns the current active page ID.
 *
 * Behavior:
 * Reads the active page ID from injected controls.
 *
 * Constraints:
 * - Requires available sidebar page controls
 *
 * Non-Goals:
 * - Does not watch for activation changes outside reactivity
 */
export function useActivePageId(): string | null {
    const { pageId } = useSidebarPageControls();
    return pageId;
}

/**
 * `useSwitchToPage`
 *
 * Purpose:
 * Attempts to activate a specific sidebar page with error handling.
 *
 * Behavior:
 * Wraps `setActivePage` and returns false on error instead of throwing.
 *
 * Constraints:
 * - Requires available sidebar page controls
 *
 * Non-Goals:
 * - Does not provide custom error recovery
 */
export async function useSwitchToPage(pageId: string): Promise<boolean> {
    const { setActivePage } = useSidebarPageControls();
    try {
        return await setActivePage(pageId);
    } catch (error) {
        if (import.meta.dev) {
            console.error(
                '[useSwitchToPage] Failed to switch to page:',
                pageId,
                error
            );
        }
        return false;
    }
}

/**
 * `useResetToDefaultPage`
 *
 * Purpose:
 * Resets the sidebar to the default page with error handling.
 *
 * Behavior:
 * Wraps `resetToDefault` and returns false on error.
 *
 * Constraints:
 * - Requires available sidebar page controls
 *
 * Non-Goals:
 * - Does not emit telemetry or hooks on its own
 */
export async function useResetToDefaultPage(): Promise<boolean> {
    const { resetToDefault } = useSidebarPageControls();
    try {
        return await resetToDefault();
    } catch (error) {
        if (import.meta.dev) {
            console.error(
                '[useResetToDefaultPage] Failed to reset to default page:',
                error
            );
        }
        return false;
    }
}

/**
 * `useSidebarPageState`
 *
 * Purpose:
 * Bundles sidebar page state and helper actions into one composable.
 *
 * Behavior:
 * Returns reactive state from injected controls and convenience helpers.
 *
 * Constraints:
 * - Requires available sidebar page controls
 *
 * Non-Goals:
 * - Does not register or manage sidebar pages
 */
export function useSidebarPageState() {
    const controls = useSidebarPageControls();
    
    return {
        // Current state
        activePageId: controls.pageId,
        isActive: controls.isActive,
        
        // Actions
        setActivePage: controls.setActivePage,
        resetToDefault: controls.resetToDefault,
        
        // Convenience helpers
        switchToPage: useSwitchToPage,
        resetToDefaultPage: useResetToDefaultPage,
        isActivePage: useIsActivePage,
        getActivePageId: useActivePageId,
    };
}
