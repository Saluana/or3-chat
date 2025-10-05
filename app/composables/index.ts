/** Barrel export for chat-related composables (Task 1.6) */
export * from './useStreamAccumulator';
export * from './useObservedElementSize';
export * from './ui-extensions/messages/useMessageActions';
export * from './ui-extensions/documents/useDocumentHistoryActions';
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
