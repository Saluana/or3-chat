import { computed, ref, watch } from 'vue';
import { useSidebarPages } from './useSidebarPages';
import type { RegisteredSidebarPage, SidebarActivateContext } from './useSidebarPages';
import { useHooks } from '~/core/hooks/useHooks';

const DEFAULT_PAGE_ID = 'sidebar-home';
const STORAGE_KEY = 'or3-active-sidebar-page';

function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function persistActivePage(pageId: string) {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(STORAGE_KEY, pageId);
    } catch (e) {
        console.warn('[useActiveSidebarPage] failed to persist active page', e);
    }
}

function loadActivePage(): string | null {
    if (!isBrowser()) return null;
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[useActiveSidebarPage] failed to load active page', e);
        return null;
    }
}

/**
 * Composable for managing the active sidebar page state.
 * Handles persistence, activation hooks, and page transitions.
 */
export function useActiveSidebarPage() {
    const { getSidebarPage } = useSidebarPages();
    const hooks = useHooks();

    // Initialize active page ID from storage or default
    const storedId = loadActivePage();
    const activePageId = ref<string>(storedId || DEFAULT_PAGE_ID);

    // Computed for the active page definition
    const activePageDef = computed<RegisteredSidebarPage | null>(() => {
        return getSidebarPage(activePageId.value) || getSidebarPage(DEFAULT_PAGE_ID) || null;
    });

    // Track previous page for hooks
    const previousPageId = ref<string | null>(null);

    /**
     * Set the active sidebar page with hook execution
     */
    async function setActivePage(id: string): Promise<boolean> {
        if (!process.client) {
            return false;
        }

        const nextPage = getSidebarPage(id) || getSidebarPage(DEFAULT_PAGE_ID);
        if (!nextPage) {
            if (import.meta.dev) {
                console.warn(`[useActiveSidebarPage] Unknown page id: ${id}, falling back to default`);
            }
            return false;
        }

        const currentPage = getSidebarPage(activePageId.value);
        
        // Create activation context
        const ctx: SidebarActivateContext = {
            page: nextPage,
            previousPage: currentPage || null,
            isCollapsed: false, // Will be updated when we integrate with sidebar state
            multiPane: null, // Will be populated when we create the adapter
            panePluginApi: null, // Will be populated when we create the adapter
        };

        try {
            // Check activation guard
            if (nextPage.canActivate) {
                const canActivate = await Promise.resolve(nextPage.canActivate(ctx));
                if (!canActivate) {
                    return false;
                }
            }

            // Deactivate current page
            if (currentPage?.onDeactivate) {
                await Promise.resolve(currentPage.onDeactivate(ctx));
            }

            // Update state
            previousPageId.value = activePageId.value;
            activePageId.value = nextPage.id;

            // Activate new page
            if (nextPage.onActivate) {
                await Promise.resolve(nextPage.onActivate(ctx));
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
            console.error('[useActiveSidebarPage] Error during page activation:', error);
            // Revert to previous page on error
            if (previousPageId.value) {
                activePageId.value = previousPageId.value;
            }
            return false;
        }
    }

    /**
     * Reset to the default page
     */
    async function resetToDefault(): Promise<boolean> {
        return await setActivePage(DEFAULT_PAGE_ID);
    }

    /**
     * Watch for page changes and validate they exist
     */
    watch(activePageId, (newId) => {
        const page = getSidebarPage(newId);
        if (!page && newId !== DEFAULT_PAGE_ID) {
            console.warn(`[useActiveSidebarPage] Active page ${newId} not found, resetting to default`);
            activePageId.value = DEFAULT_PAGE_ID;
        }
    });

    return {
        activePageId: computed(() => activePageId.value),
        activePageDef,
        setActivePage,
        resetToDefault,
    };
}
