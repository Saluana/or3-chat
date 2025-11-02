// Re-export all sidebar composables
// Core sidebar composables
export { useActiveSidebarPage } from './useActiveSidebarPage';
export { useSidebarPages } from './useSidebarPages';

// Environment and data access helpers
export { 
    provideSidebarEnvironment,
    provideSidebarPageControls,
    useSidebarEnvironment,
    useSidebarProjects,
    useSidebarThreads,
    useSidebarDocuments,
    useSidebarSections,
    useSidebarPostsApi,
    useSidebarMultiPane,
    createSidebarMultiPaneApi,
    type SidebarEnvironment,
    type SidebarPageControls,
    type SidebarMultiPaneApi
} from './useSidebarEnvironment';

// Page controls and state management
export {
    useSidebarPageControls,
    useIsActivePage,
    useActivePageId,
    useSwitchToPage,
    useResetToDefaultPage,
    useSidebarPageState,
} from './useSidebarPageControls';

// Registration helpers with DX improvements
export {
    registerSidebarPage,
    type RegisterSidebarPageOptions,
    type RegisterSidebarPageWithPostsOptions,
} from './registerSidebarPage';

// Re-export types for convenience
export type { SidebarPageDef, RegisteredSidebarPage } from './useSidebarPages';
export type { SidebarActivateContext, SidebarPageContext } from './useActiveSidebarPage';
