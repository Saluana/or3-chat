/**
 * OR3 Client - Unified Entry Point
 *
 * The single, discoverable, strongly-typed entry point for all extension points.
 *
 * @example
 * // In a Vue component
 * const { ui, ai, core } = useOR3Client();
 * ui.sidebar.pages.register({ id: 'my-page', ... });
 *
 * @example
 * // In a plugin
 * const { $or3client } = useNuxtApp();
 * $or3client.ai.tools.use().registerTool({ ... });
 */

// Core API
export { createOR3Client } from './client';
export type {
    OR3Client,
    UIClient,
    AIClient,
    CoreClient,
    SidebarClient,
    DashboardClient,
    ChatClient,
    EditorClient,
    PaneClient,
    ProjectClient,
    ThreadClient,
    DocumentClient,
    // Adapter interfaces
    SidebarSectionsAdapter,
    SidebarFooterActionsAdapter,
    HeaderActionsAdapter,
    ComposerActionsAdapter,
    SidebarPagesAdapter,
    DashboardPagesAdapter,
    DashboardNavigationAdapter,
    ChatInputBridgeAdapter,
    EditorNodesAdapter,
    EditorMarksAdapter,
    EditorExtensionsAdapter,
    EditorLoaderAdapter,
    PaneAppsAdapter,
    ToolsAdapter,
    HooksAdapter,
} from './client';

// Utility types and functions
export type { RegistryAdapter, ServiceAdapter } from './utils';
export { clientOnlyAdapter, clientOnlyServiceAdapter } from './utils';

// Type re-exports (from source modules)
export * from './types';

// Define helpers
export * from './define';

// Composable
export { useOR3Client } from './composable';
