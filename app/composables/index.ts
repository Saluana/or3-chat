/** Barrel export for chat-related composables (Task 1.6) */
export * from './chat/useStreamAccumulator';
export * from './dashboard/useDashboardPlugins';
export * from './core/useWorkspaceBackup';

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

// Thread composables
export * from './threads/useThreadHistoryActions';
export * from './threads/useThreadSearch';

// Hook composables
export * from '../core/hooks/useHooks';
export * from './core/useHookEffect';

// Project composables
export * from './projects/useProjectTreeActions';
export * from './projects/useProjectsCrud';
