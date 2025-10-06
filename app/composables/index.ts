/** Barrel export for chat-related composables (Task 1.6) */
export * from './useStreamAccumulator';
export * from './useObservedElementSize';
export * from './useHooks';
export * from './documents/useDocumentHistoryActions';
export * from './ui-extensions/threads/useThreadHistoryActions';
export * from './ui-extensions/projects/useProjectTreeActions';
export {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    useDashboardPlugins,
    registerDashboardPluginPage,
    unregisterDashboardPluginPage,
    useDashboardPluginPages,
    listDashboardPluginPages,
    getDashboardPluginPage,
    resolveDashboardPluginPageComponent,
    useDashboardNavigation,
    hasCapability,
    getPluginCapabilities,
    hasAllCapabilities,
    hasAnyCapability,
    type DashboardPlugin,
    type DashboardPluginPage,
} from './dashboard/useDashboardPlugins';
export * from './editor/useEditorToolbar';
export * from './editor/useEditorNodes';
export * from './useWorkspaceBackup';

//Sidebar composables
export * from './sidebar/useSidebarSections';
export * from './sidebar/useHeaderActions';
export * from './sidebar/useComposerActions';
export * from './sidebar/useSidebarSearch';

// Document composables
export * from './documents/useDocumentsStore';
export * from './documents/useDocumentsList';
export * from './documents/useDocumentHistoryActions';
export * from './documents/usePaneDocuments';

//Editor composables
export * from './editor/useEditorToolbar';
export * from './editor/useEditorNodes';

// Chat composables
export * from './chat/useActivePrompt';
export * from './chat/useAi';
export * from './chat/useAiSettings';
export * from './chat/useChatInputBridge';
export * from './chat/useDefaultPrompt';
export * from './chat/useMessageEditing';
export * from './chat/useModelStore';
export * from './chat/useMessageActions';

// Hook composables
export * from './useHooks';
export * from './useHookEffect';
