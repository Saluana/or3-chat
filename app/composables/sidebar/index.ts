// Re-export all sidebar composables for easier imports
export { useSidebarPages } from './useSidebarPages';
export { useActiveSidebarPage } from './useActiveSidebarPage';
export { 
    provideSidebarEnvironment,
    provideSidebarPageControls,
    useSidebarEnvironment,
    useSidebarProjects,
    useSidebarThreads,
    useSidebarDocuments,
    useSidebarSections,
    useSidebarQuery,
    useActiveSections,
    useExpandedProjects,
    useActiveThreadIds,
    useActiveDocumentIds,
    useSidebarFooterActions,
    useSidebarMultiPane,
    useSidebarPostsApi,
    useSidebarPageControls,
    createSidebarMultiPaneApi,
    SidebarEnvironmentKey,
    type SidebarEnvironment,
    type SidebarMultiPaneApi,
    type SidebarPageControls
} from './useSidebarEnvironment';
