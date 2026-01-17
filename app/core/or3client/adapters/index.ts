/**
 * OR3 Client Adapters Barrel Export
 *
 * Export all adapters from a single location.
 */

// Phase 2 - Simple Registry Adapters
export { createMessageActionsAdapter } from './message-actions';
export { createEditorToolbarAdapter } from './editor-toolbar';
export { createProjectTreeActionsAdapter } from './project-tree-actions';
export { createThreadHistoryActionsAdapter } from './thread-history-actions';
export { createDocumentHistoryActionsAdapter } from './document-history-actions';
export { createSidebarSectionsAdapter } from './sidebar-sections';
export { createSidebarFooterActionsAdapter } from './sidebar-footer-actions';
export { createHeaderActionsAdapter } from './sidebar-header-actions';
export { createComposerActionsAdapter } from './sidebar-composer-actions';

// Phase 3 - Complex Registry Adapters
export { createSidebarPagesAdapter } from './sidebar-pages';
export { createDashboardPluginsAdapter } from './dashboard-plugins';
export { createDashboardPagesAdapter } from './dashboard-pages';
export { createDashboardNavigationAdapter } from './dashboard-navigation';
export { createEditorNodesAdapter } from './editor-nodes';
export { createEditorMarksAdapter } from './editor-marks';
export { createEditorExtensionsAdapter } from './editor-extensions';
export { createEditorLoaderAdapter } from './editor-loader';
export { createPaneAppsAdapter } from './pane-apps';
export { createToolsAdapter } from './tools';

// Phase 4 - Service Adapters
export { createMultiPaneAdapter } from './multi-pane';
export { createChatInputBridgeAdapter } from './chat-input-bridge';
export { createHooksAdapter } from './hooks';
