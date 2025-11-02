import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useSidebarPages } from './useSidebarPages';
import type {
    RegisteredSidebarPage,
    SidebarActivateContext,
} from './useSidebarPages';
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

// Global singleton state (similar to useSidebarPages registry pattern)
const g: any = globalThis as any;

// Initialize global state once
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
    const state = (globalThis as any).__or3ActiveSidebarPageState;
    const activePageId = state.activePageId;
    const previousPageId = state.previousPageId;
    const initialRequestedPageId = state.initialRequestedPageId;

    // Computed for the active page definition
    const activePageDef = computed<RegisteredSidebarPage | null>(() => {
        return (
            getSidebarPage(activePageId.value) ||
            getSidebarPage(DEFAULT_PAGE_ID) ||
            null
        );
    });

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
                console.warn(
                    `[useActiveSidebarPage] Unknown page id: ${id}, falling back to default`
                );
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
                const canActivate = await Promise.resolve(
                    nextPage.canActivate(ctx)
                );
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
            console.error(
                '[useActiveSidebarPage] Error during page activation:',
                error
            );
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
            console.warn(
                `[useActiveSidebarPage] Active page ${newId} not found, resetting to default`
            );
            activePageId.value = DEFAULT_PAGE_ID;
        }
    });

    // Only run initialization logic once globally
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
        activePageId: computed(() => activePageId.value),
        activePageDef,
        setActivePage,
        resetToDefault,
    };
}
