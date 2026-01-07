/**
 * Global Sidebar Layout API
 *
 * Provides access to sidebar layout controls from any component.
 * This is set by PageShell.vue on mount and can be used by plugins
 * to control sidebar state (e.g., closing on mobile after selection).
 */

export interface SidebarLayoutApi {
    /** Close the sidebar (useful for mobile after selection) */
    close: () => void;
    /** Open the sidebar */
    open: () => void;
    /** Toggle sidebar collapsed state (desktop) */
    toggleCollapse: () => void;
    /** Expand sidebar (uncollapse on desktop, open on mobile) */
    expand: () => void;
    /** Check if currently on mobile */
    isMobile: () => boolean;
    /** Close sidebar only if on mobile - convenience method */
    closeSidebarIfMobile: () => void;
}

type GlobalSidebarLayout = typeof globalThis & {
    __or3SidebarLayoutApi?: SidebarLayoutApi;
};

/**
 * Get the global sidebar layout API if available.
 * Returns undefined if PageShell hasn't mounted yet.
 */
export function getGlobalSidebarLayoutApi(): SidebarLayoutApi | undefined {
    return (globalThis as GlobalSidebarLayout).__or3SidebarLayoutApi;
}

/**
 * Set the global sidebar layout API.
 * Called by PageShell.vue on mount.
 */
export function setGlobalSidebarLayoutApi(
    api: SidebarLayoutApi | undefined
): void {
    (globalThis as GlobalSidebarLayout).__or3SidebarLayoutApi = api;
}

/**
 * Convenience function to close the sidebar if on mobile.
 * Safe to call even if the API isn't available yet.
 */
export function closeSidebarIfMobile(): void {
    const api = getGlobalSidebarLayoutApi();
    api?.closeSidebarIfMobile();
}
