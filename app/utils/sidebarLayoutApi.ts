/**
 * @module app/utils/sidebarLayoutApi
 *
 * Purpose:
 * Exposes a global sidebar layout API for components and plugins.
 *
 * Behavior:
 * - The API is set by PageShell.vue on mount
 * - Consumers can safely call helpers even before mount
 */

/**
 * `SidebarLayoutApi`
 *
 * Purpose:
 * Contract for sidebar layout controls provided by PageShell.
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
 * `getGlobalSidebarLayoutApi`
 *
 * Purpose:
 * Returns the sidebar layout API if PageShell is mounted.
 */
export function getGlobalSidebarLayoutApi(): SidebarLayoutApi | undefined {
    return (globalThis as GlobalSidebarLayout).__or3SidebarLayoutApi;
}

/**
 * `setGlobalSidebarLayoutApi`
 *
 * Purpose:
 * Registers the sidebar layout API on `globalThis`.
 */
export function setGlobalSidebarLayoutApi(
    api: SidebarLayoutApi | undefined
): void {
    (globalThis as GlobalSidebarLayout).__or3SidebarLayoutApi = api;
}

/**
 * `closeSidebarIfMobile`
 *
 * Purpose:
 * Convenience helper that closes the sidebar only on mobile.
 */
export function closeSidebarIfMobile(): void {
    const api = getGlobalSidebarLayoutApi();
    api?.closeSidebarIfMobile();
}
