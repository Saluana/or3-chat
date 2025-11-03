import { inject } from 'vue';
import { SidebarPageControlsKey, type SidebarPageControls } from './useSidebarEnvironment';

/**
 * Composable for accessing sidebar page controls from the current component context.
 * Provides methods to change pages without receiving large prop bags.
 * Must be used within a component tree where provideSidebarPageControls was called.
 * 
 * @returns The SidebarPageControls instance
 * @throws Error if used outside of a provided SidebarPageControls context
 */
export function useSidebarPageControls(): SidebarPageControls {
    const controls = inject(SidebarPageControlsKey);
    if (!controls) {
        throw new Error('useSidebarPageControls must be used within a component that provides SidebarPageControls');
    }
    return controls;
}

/**
 * Helper to check if a specific page is currently active.
 * 
 * @param pageId - The page ID to check against the current active page
 * @returns True if the specified page is currently active, false otherwise
 */
export function useIsActivePage(pageId: string): boolean {
    const { pageId: activePageId } = useSidebarPageControls();
    return activePageId === pageId;
}

/**
 * Helper to get the current active page ID.
 * 
 * @returns The ID of the currently active page, or null if no page is active
 */
export function useActivePageId(): string | null {
    const { pageId } = useSidebarPageControls();
    return pageId;
}

/**
 * Helper to switch to a specific page with built-in error handling.
 * Wraps the setActivePage method and returns false on any error instead of throwing.
 * 
 * @param pageId - The ID of the page to switch to
 * @returns True if the page was successfully switched, false if an error occurred
 */
export async function useSwitchToPage(pageId: string): Promise<boolean> {
    const { setActivePage } = useSidebarPageControls();
    try {
        return await setActivePage(pageId);
    } catch (error) {
        return false;
    }
}

/**
 * Helper to reset to the default page with built-in error handling.
 * Wraps the resetToDefault method and returns false on any error instead of throwing.
 * 
 * @returns True if successfully reset to default page, false if an error occurred
 */
export async function useResetToDefaultPage(): Promise<boolean> {
    const { resetToDefault } = useSidebarPageControls();
    try {
        return await resetToDefault();
    } catch (error) {
        return false;
    }
}

/**
 * Composable that provides complete sidebar page state and helper functions together.
 * Returns a comprehensive object with both reactive state and all available actions.
 * 
 * @returns Object containing:
 * - activePageId: Current active page ID (reactive)
 * - isActive: Whether any page is currently active (reactive)
 * - setActivePage: Function to set a specific page as active
 * - resetToDefault: Function to reset to the default page
 * - switchToPage: Safe wrapper to switch pages with error handling
 * - resetToDefaultPage: Safe wrapper to reset with error handling
 * - isActivePage: Function to check if a specific page is active
 * - getActivePageId: Function to get the current active page ID
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
