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
} from './ui-extensions/dashboard/useDashboardPlugins';
export * from './ui-extensions/editor/useEditorToolbar';
export * from './ui-extensions/editor/useEditorNodes';
export * from './useWorkspaceBackup';

// Document composables
export * from './documents/useDocumentsStore';
export * from './documents/useDocumentsList';
export * from './documents/useDocumentHistoryActions';
export * from './documents/usePaneDocuments';

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
