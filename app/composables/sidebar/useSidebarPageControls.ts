import { inject } from 'vue';
import { SidebarPageControlsKey, type SidebarPageControls } from './useSidebarEnvironment';

/**
 * Composable for accessing sidebar page controls
 * Provides methods to change pages without receiving large prop bags
 */
export function useSidebarPageControls(): SidebarPageControls {
    const controls = inject(SidebarPageControlsKey);
    if (!controls) {
        throw new Error('useSidebarPageControls must be used within a component that provides SidebarPageControls');
    }
    return controls;
}

/**
 * Helper to check if a specific page is currently active
 */
export function useIsActivePage(pageId: string): boolean {
    const { pageId: activePageId } = useSidebarPageControls();
    return activePageId === pageId;
}

/**
 * Helper to get the current active page ID
 */
export function useActivePageId(): string {
    const { pageId } = useSidebarPageControls();
    return pageId;
}

/**
 * Helper to switch to a specific page with error handling
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
 * Helper to reset to the default page
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
 * Composable that provides page state and helpers together
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
