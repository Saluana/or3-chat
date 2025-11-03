/**
 * Composable for managing the active sidebar page state with persistence and lifecycle hooks.
 * Handles page transitions, activation guards, and maintains global singleton state.
 * Integrates with the hooks system for extensibility and analytics.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useSidebarPages } from './useSidebarPages';
import type {
    RegisteredSidebarPage,
    SidebarActivateContext,
} from './useSidebarPages';
import { useHooks } from '~/core/hooks/useHooks';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

/**
 * Default page ID used when no specific page is requested or available.
 */
const DEFAULT_PAGE_ID = 'sidebar-home';

/**
 * Local storage key for persisting the active page across sessions.
 */
const STORAGE_KEY = 'or3-active-sidebar-page';

/**
 * Browser environment check for safe localStorage access.
 * 
 * @returns True if running in a browser environment
 */
function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Persist the active page ID to localStorage.
 * Handles storage errors gracefully with warning logs.
 * 
 * @param pageId - The page ID to persist
 */
function persistActivePage(pageId: string) {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(STORAGE_KEY, pageId);
    } catch (e) {
        console.warn('[useActiveSidebarPage] failed to persist active page', e);
    }
}

/**
 * Load the active page ID from localStorage.
 * Handles storage errors gracefully with warning logs.
 * 
 * @returns The stored page ID, or null if unavailable
 */
function loadActivePage(): string | null {
    if (!isBrowser()) return null;
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[useActiveSidebarPage] failed to load active page', e);
        return null;
    }
}

// Global singleton state (similar to useSidebarPages registry pattern)
const g = globalThis as {
    __or3ActiveSidebarPageState?: {
        activePageId: ReturnType<typeof ref<string>>;
        previousPageId: ReturnType<typeof ref<string | null>>;
        initialRequestedPageId: string | null;
        isInitialized: boolean;
    };
};

/**
 * Initialize global singleton state once for the entire application.
 * Ensures consistent state across all component instances.
 */
if (!g.__or3ActiveSidebarPageState) {
    const storedId = loadActivePage();
    const initialRequestedPageId =
        storedId && storedId !== DEFAULT_PAGE_ID ? storedId : null;

    g.__or3ActiveSidebarPageState = {
        activePageId: ref<string>(
            initialRequestedPageId
                ? DEFAULT_PAGE_ID
                : storedId || DEFAULT_PAGE_ID
        ),
        previousPageId: ref<string | null>(null),
        initialRequestedPageId,
        isInitialized: false, // Track if we've run the mount logic
    };
}

/**
 * Composable for managing the active sidebar page state.
 * Handles persistence, activation hooks, and page transitions.
 * Uses global singleton state to ensure consistency across all components.
 */
export function useActiveSidebarPage() {
    const { getSidebarPage, listSidebarPages } = useSidebarPages();
    const hooks = useHooks();

    // Get global singleton state
    const state = g.__or3ActiveSidebarPageState!;
    const activePageId = state.activePageId;
    const previousPageId = state.previousPageId;
    const initialRequestedPageId = state.initialRequestedPageId;

    // Computed for the active page definition
    const activePageDef = computed<RegisteredSidebarPage | null>(() => {
        const pageId = activePageId.value ?? DEFAULT_PAGE_ID;
        return (
            getSidebarPage(pageId) || getSidebarPage(DEFAULT_PAGE_ID) || null
        );
    });

/**
 * Set the active sidebar page with comprehensive hook execution and error handling.
 * Executes activation guards, deactivation hooks, and activation hooks in sequence.
 * Handles errors gracefully with state rollback and proper error reporting.
 * 
 * @param id - The ID of the page to activate
 * @returns True if activation succeeded, false if it failed or was blocked
 */
    async function setActivePage(id: string): Promise<boolean> {
        if (!process.client) {
            return false;
        }

        const nextPage = getSidebarPage(id) || getSidebarPage(DEFAULT_PAGE_ID);
        if (!nextPage) {
            if (import.meta.dev) {
                console.warn(
                    `[useActiveSidebarPage] Unknown page id: ${id}, falling back to default`
                );
            }
            await hooks.doAction('ui.sidebar.page:action:load-error', {
                pageId: id,
                error: new Error(`Unknown page id: ${id}`),
            });
            return false;
        }

        const currentPageId = activePageId.value ?? DEFAULT_PAGE_ID;
        const currentPage = getSidebarPage(currentPageId);
        const previousPageIdSnapshot = activePageId.value;

        // Create activation context
        const ctx: SidebarActivateContext = {
            page: nextPage,
            previousPage: currentPage || null,
            isCollapsed: false, // Will be updated when we integrate with sidebar state
            multiPane: null as unknown as UseMultiPaneApi, // Will be populated when we create the adapter
            panePluginApi: null as unknown as PanePluginApi, // Will be populated when we create the adapter
        };

        try {
            // Check activation guard
            if (nextPage.canActivate) {
                try {
                    const canActivate = await Promise.resolve(
                        nextPage.canActivate(ctx)
                    );
                    if (!canActivate) {
                        if (import.meta.dev) {
                            console.log(
                                `[useActiveSidebarPage] canActivate returned false for ${id}`
                            );
                        }
                        return false;
                    }
                } catch (guardError) {
                    console.error(
                        `[useActiveSidebarPage] canActivate hook failed for ${id}:`,
                        guardError
                    );
                    await hooks.doAction('ui.sidebar.page:action:load-error', {
                        pageId: id,
                        error: guardError,
                        phase: 'canActivate',
                    });
                    return false;
                }
            }

            // Deactivate current page
            if (currentPage?.onDeactivate) {
                try {
                    await Promise.resolve(currentPage.onDeactivate(ctx));
                } catch (deactivateError) {
                    // Log but don't block the transition
                    console.error(
                        `[useActiveSidebarPage] onDeactivate hook failed for ${currentPage.id}:`,
                        deactivateError
                    );
                    await hooks.doAction('ui.sidebar.page:action:load-error', {
                        pageId: currentPage.id,
                        error: deactivateError,
                        phase: 'onDeactivate',
                    });
                }
            }

            // Update state
            previousPageId.value = activePageId.value;
            activePageId.value = nextPage.id;

            // Activate new page
            if (nextPage.onActivate) {
                try {
                    await Promise.resolve(nextPage.onActivate(ctx));
                } catch (activateError) {
                    console.error(
                        `[useActiveSidebarPage] onActivate hook failed for ${id}:`,
                        activateError
                    );
                    // Roll back state
                    activePageId.value = previousPageIdSnapshot;
                    await hooks.doAction('ui.sidebar.page:action:load-error', {
                        pageId: id,
                        error: activateError,
                        phase: 'onActivate',
                    });
                    return false;
                }
            }

            // Persist the selection
            persistActivePage(nextPage.id);

            // Emit analytics hook
            await hooks.doAction('ui.sidebar.page:action:open', {
                id: nextPage.id,
                page: nextPage,
            });

            return true;
        } catch (error) {
            console.error(
                '[useActiveSidebarPage] Unexpected error during page activation:',
                error
            );
            // Revert to previous page on error
            activePageId.value = previousPageIdSnapshot;
            await hooks.doAction('ui.sidebar.page:action:load-error', {
                pageId: id,
                error,
                phase: 'general',
            });
            return false;
        }
    }

    /**
     * Reset to the default page (sidebar-home).
 * Provides a simple way to return to the home page.
     * 
     * @returns True if reset succeeded, false if it failed
     */
    async function resetToDefault(): Promise<boolean> {
        return await setActivePage(DEFAULT_PAGE_ID);
    }

    /**
     * Watch for page changes and validate they exist in the registry.
     * Automatically resets to default page if the active page becomes unavailable.
     */
    watch(activePageId, (newId) => {
        const pageId = newId ?? DEFAULT_PAGE_ID;
        const page = getSidebarPage(pageId);
        if (!page && pageId !== DEFAULT_PAGE_ID) {
            console.warn(
                `[useActiveSidebarPage] Active page ${pageId} not found, resetting to default`
            );
            activePageId.value = DEFAULT_PAGE_ID;
        }
    });

    // Only run initialization logic once globally
    /**
     * Initialize the composable by attempting to restore the previously active page.
     * Watches for page registration if the requested page isn't immediately available.
     * Ensures proper cleanup on component unmount.
     */
    onMounted(() => {
        if (state.isInitialized || !initialRequestedPageId) return;
        state.isInitialized = true;

        const attemptActivation = async () => {
            await setActivePage(initialRequestedPageId);
        };

        if (getSidebarPage(initialRequestedPageId)) {
            attemptActivation();
            return;
        }

        const stop = watch(
            () => listSidebarPages.value.map((page) => page.id),
            (ids) => {
                if (ids.includes(initialRequestedPageId)) {
                    attemptActivation();
                    stop();
                }
            },
            { immediate: true }
        );

        // Add cleanup on unmount
        onUnmounted(() => {
            stop();
        });
    });

    return {
        /** Reactive ID of the currently active page */
        activePageId: computed(() => activePageId.value),
        /** Reactive definition of the currently active page */
        activePageDef,
        /** Function to set the active page with hook execution */
        setActivePage,
        /** Function to reset to the default page */
        resetToDefault,
    };
}
