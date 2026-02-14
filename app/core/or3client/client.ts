/**
 * OR3 Client Implementation
 *
 * The unified entry point for all extension points in OR3.
 * This is the core API surface that wraps existing registries and services.
 */

import type { ComputedRef } from 'vue';
import type { RegistryAdapter, ServiceAdapter } from './utils';

// Import types from source modules
import type {
    SidebarSection,
    SidebarSectionGroups,
    SidebarFooterAction,
    SidebarFooterActionContext,
    SidebarFooterActionEntry,
    HeaderAction,
    HeaderActionContext,
    HeaderActionEntry,
    ComposerAction,
    ComposerActionContext,
    ComposerActionEntry,
    SidebarPageDef,
    RegisteredSidebarPage,
    DashboardPlugin,
    DashboardPluginPage,
    PaneAppDef,
    RegisteredPaneApp,
    UseMultiPaneApi,
    ChatMessageAction,
    EditorToolbarButton,
    EditorNode,
    EditorMark,
    EditorExtension,
    LoadedExtensions,
    ProjectTreeAction,
    ThreadHistoryAction,
    DocumentHistoryAction,
    TypedHookEngine,
} from './types';

// ============================================================================
// Client Namespace Interfaces
// ============================================================================

/**
 * Sidebar client - adapters for sidebar UI extensions.
 */
export interface SidebarClient {
    /** Sidebar sections (top/main/bottom) registry */
    sections: SidebarSectionsAdapter;
    /** Footer action buttons registry */
    footerActions: SidebarFooterActionsAdapter;
    /** Header action buttons registry */
    headerActions: HeaderActionsAdapter;
    /** Composer (editor toolbar) actions registry */
    composerActions: ComposerActionsAdapter;
    /** Sidebar pages (full-panel views) registry */
    pages: SidebarPagesAdapter;
}

/**
 * Dashboard client - adapters for dashboard extensions.
 */
export interface DashboardClient {
    /** Dashboard plugins registry */
    plugins: RegistryAdapter<DashboardPlugin>;
    /** Dashboard plugin pages registry */
    pages: DashboardPagesAdapter;
    /** Dashboard navigation service */
    navigation: DashboardNavigationAdapter;
}

/**
 * Chat client - adapters for chat UI extensions.
 */
export interface ChatClient {
    /** Message action buttons registry */
    messageActions: RegistryAdapter<ChatMessageAction>;
    /** Chat input bridge service */
    inputBridge: ChatInputBridgeAdapter;
}

/**
 * Editor client - adapters for editor extensions.
 */
export interface EditorClient {
    /** Editor toolbar buttons registry */
    toolbar: RegistryAdapter<EditorToolbarButton>;
    /** TipTap node extensions registry */
    nodes: EditorNodesAdapter;
    /** TipTap mark extensions registry */
    marks: EditorMarksAdapter;
    /** TipTap generic extensions registry */
    extensions: EditorExtensionsAdapter;
    /** Extension loader utilities */
    loader: EditorLoaderAdapter;
}

/**
 * Panes client - adapters for multi-pane workspace.
 */
export interface PaneClient {
    /** Pane app definitions registry */
    apps: PaneAppsAdapter;
    /** Multi-pane manager service */
    manager: ServiceAdapter<UseMultiPaneApi>;
}

/**
 * Projects client - adapters for project tree actions.
 */
export interface ProjectClient {
    /** Project tree action buttons registry */
    treeActions: RegistryAdapter<ProjectTreeAction>;
}

/**
 * Threads client - adapters for thread history actions.
 */
export interface ThreadClient {
    /** Thread history action buttons registry */
    historyActions: RegistryAdapter<ThreadHistoryAction>;
}

/**
 * Documents client - adapters for document history actions.
 */
export interface DocumentClient {
    /** Document history action buttons registry */
    historyActions: RegistryAdapter<DocumentHistoryAction>;
}

/**
 * UI namespace - all user interface extension points.
 */
export interface UIClient {
    sidebar: SidebarClient;
    dashboard: DashboardClient;
    chat: ChatClient;
    editor: EditorClient;
    panes: PaneClient;
    projects: ProjectClient;
    threads: ThreadClient;
    documents: DocumentClient;
}

/**
 * AI namespace - AI-related extension points.
 */
export interface AIClient {
    /** Tool registry service */
    tools: ToolsAdapter;
    // NOTE: models and prompts are reserved for future phases.
}

/**
 * Core namespace - core system extension points.
 */
export interface CoreClient {
    /** Hooks engine service */
    hooks: HooksAdapter;
    // NOTE: theme and search are reserved for future phases.
}

/**
 * Main OR3 Client interface.
 * The unified entry point for all extension points.
 */
export interface OR3Client {
    /** API version for plugin compatibility checks */
    readonly version: 1;

    /** UI extension points */
    ui: UIClient;

    /** AI extension points */
    ai: AIClient;

    /** Core system extension points */
    core: CoreClient;
}

// ============================================================================
// Specialized Adapter Interfaces
// ============================================================================

/**
 * Sidebar sections adapter with grouped output.
 */
export interface SidebarSectionsAdapter
    extends Omit<RegistryAdapter<SidebarSection>, 'useItems'> {
    /** Reactive groups of sections by placement (top/main/bottom) */
    useGrouped(): ComputedRef<SidebarSectionGroups>;
    /** Reactive flat list of all sections */
    useItems(): ComputedRef<readonly SidebarSection[]>;
}

/**
 * Footer actions adapter with context-aware filtering.
 */
export interface SidebarFooterActionsAdapter
    extends Omit<RegistryAdapter<SidebarFooterAction>, 'useItems'> {
    /** Reactive list with disabled state computed from context */
    useItems(
        context?: () => SidebarFooterActionContext
    ): ComputedRef<SidebarFooterActionEntry[]>;
}

/**
 * Header actions adapter with context-aware filtering.
 */
export interface HeaderActionsAdapter
    extends Omit<RegistryAdapter<HeaderAction>, 'useItems'> {
    /** Reactive list with disabled state computed from context */
    useItems(
        context?: () => HeaderActionContext
    ): ComputedRef<HeaderActionEntry[]>;
}

/**
 * Composer actions adapter with TipTap context filtering.
 */
export interface ComposerActionsAdapter
    extends Omit<RegistryAdapter<ComposerAction>, 'useItems'> {
    /** Reactive list with disabled state computed from TipTap editor context */
    useItems(
        context?: () => ComposerActionContext
    ): ComputedRef<ComposerActionEntry[]>;
}

/**
 * Sidebar pages adapter preserving lifecycle hooks.
 */
export interface SidebarPagesAdapter
    extends Omit<RegistryAdapter<RegisteredSidebarPage>, 'register'> {
    /** Register returns an unregister function for cleanup */
    register(def: SidebarPageDef): () => void;
}

/**
 * Dashboard pages adapter supporting per-plugin pages.
 */
export interface DashboardPagesAdapter {
    /** Register a page for a specific plugin */
    register(pluginId: string, page: DashboardPluginPage): void;
    /** Unregister a page or all pages for a plugin */
    unregister(pluginId: string, pageId?: string): void;
    /** Get a specific page */
    get(pluginId: string, pageId: string): DashboardPluginPage | undefined;
    /** List all pages for a plugin */
    list(pluginId: string): DashboardPluginPage[];
    /** Reactive list of pages for a plugin */
    useItems(pluginId: () => string | undefined): ComputedRef<DashboardPluginPage[]>;
}

/**
 * Dashboard navigation adapter for page resolution.
 */
export interface DashboardNavigationAdapter {
    /** Navigate to a plugin/page */
    navigate(pluginId: string, pageId?: string): Promise<void>;
    /** Resolve page component */
    resolveComponent(
        pluginId: string,
        pageId: string
    ): Promise<import('vue').Component | undefined>;
    /** Get navigation state */
    useNavigation(): ReturnType<typeof import('~/composables/dashboard/useDashboardPlugins').useDashboardNavigation>;
}

/**
 * Chat input bridge adapter for programmatic sends.
 */
export interface ChatInputBridgeAdapter {
    /** Register a pane's input API */
    register(paneId: string, api: { setText(t: string): void; triggerSend(): void }): void;
    /** Unregister a pane's input */
    unregister(paneId: string): void;
    /** Send a message programmatically */
    send(paneId: string, text: string): boolean;
    /** Check if a pane is registered */
    hasPane(paneId: string): boolean;
}

/**
 * Editor nodes adapter.
 */
export interface EditorNodesAdapter
    extends Omit<RegistryAdapter<EditorNode>, 'useItems'> {
    /** List all nodes (ordered) */
    list(): EditorNode[];
}

/**
 * Editor marks adapter.
 */
export interface EditorMarksAdapter
    extends Omit<RegistryAdapter<EditorMark>, 'useItems'> {
    /** List all marks (ordered) */
    list(): EditorMark[];
}

/**
 * Editor extensions adapter.
 */
export interface EditorExtensionsAdapter
    extends Omit<RegistryAdapter<EditorExtension>, 'useItems'> {
    /** List all extensions (ordered) */
    list(): EditorExtension[];
}

/**
 * Editor extension loader adapter.
 */
export interface EditorLoaderAdapter {
    /** Load all lazy extensions */
    load(
        nodes: EditorNode[],
        marks: EditorMark[],
        extensions: EditorExtension[]
    ): Promise<LoadedExtensions>;
    /** Create lazy node factory */
    createLazyNodeFactory: typeof import('~/composables/editor/useEditorExtensionLoader').createLazyNodeFactory;
    /** Create lazy mark factory */
    createLazyMarkFactory: typeof import('~/composables/editor/useEditorExtensionLoader').createLazyMarkFactory;
    /** Create lazy extension factory */
    createLazyExtensionFactory: typeof import('~/composables/editor/useEditorExtensionLoader').createLazyExtensionFactory;
}

/**
 * Pane apps adapter with Zod validation.
 */
export interface PaneAppsAdapter extends RegistryAdapter<RegisteredPaneApp> {
    /** Register validates with Zod schema */
    register(def: PaneAppDef): void;
}

/**
 * Tools adapter (service-style).
 */
export interface ToolsAdapter {
    /** Get the full tool registry API */
    use(): ReturnType<typeof import('~/utils/chat/tool-registry').useToolRegistry>;
}

/**
 * Hooks adapter.
 */
export interface HooksAdapter {
    /** Get the typed hook engine */
    engine(): TypedHookEngine;
    /** Register a hook with automatic cleanup */
    useEffect: typeof import('~/composables/core/useHookEffect').useHookEffect;
}

// ============================================================================
// Client Factory (Lazy-loaded adapters)
// ============================================================================

/**
 * Creates the OR3Client instance.
 * Adapters are lazy-loaded on first access to avoid import cycles.
 */
export function createOR3Client(): OR3Client {
    // Lazy adapter loading to break circular imports
    // Each adapter is loaded only when first accessed

    const client: OR3Client = {
        version: 1,

        ui: {
            get sidebar() {
                return getSidebarClient();
            },
            get dashboard() {
                return getDashboardClient();
            },
            get chat() {
                return getChatClient();
            },
            get editor() {
                return getEditorClient();
            },
            get panes() {
                return getPaneClient();
            },
            get projects() {
                return getProjectClient();
            },
            get threads() {
                return getThreadClient();
            },
            get documents() {
                return getDocumentClient();
            },
        },

        ai: {
            get tools() {
                return getToolsAdapter();
            },
        },

        core: {
            get hooks() {
                return getHooksAdapter();
            },
        },
    };

    return client;
}

// ============================================================================
// Lazy Adapter Loaders (Real Adapters)
// ============================================================================

// Import adapter factories
import {
    createSidebarSectionsAdapter,
    createSidebarFooterActionsAdapter,
    createHeaderActionsAdapter,
    createComposerActionsAdapter,
    createSidebarPagesAdapter,
    createDashboardPluginsAdapter,
    createDashboardPagesAdapter,
    createDashboardNavigationAdapter,
    createMessageActionsAdapter,
    createChatInputBridgeAdapter,
    createEditorToolbarAdapter,
    createEditorNodesAdapter,
    createEditorMarksAdapter,
    createEditorExtensionsAdapter,
    createEditorLoaderAdapter,
    createPaneAppsAdapter,
    createMultiPaneAdapter,
    createProjectTreeActionsAdapter,
    createThreadHistoryActionsAdapter,
    createDocumentHistoryActionsAdapter,
    createToolsAdapter,
    createHooksAdapter,
} from './adapters';

// Cached adapter instances (lazy-loaded on first access)
let _sidebarClient: SidebarClient | null = null;
function getSidebarClient(): SidebarClient {
    if (!_sidebarClient) {
        _sidebarClient = {
            sections: createSidebarSectionsAdapter(),
            footerActions: createSidebarFooterActionsAdapter(),
            headerActions: createHeaderActionsAdapter(),
            composerActions: createComposerActionsAdapter(),
            pages: createSidebarPagesAdapter(),
        };
    }
    return _sidebarClient;
}

let _dashboardClient: DashboardClient | null = null;
function getDashboardClient(): DashboardClient {
    if (!_dashboardClient) {
        _dashboardClient = {
            plugins: createDashboardPluginsAdapter(),
            pages: createDashboardPagesAdapter(),
            navigation: createDashboardNavigationAdapter(),
        };
    }
    return _dashboardClient;
}

let _chatClient: ChatClient | null = null;
function getChatClient(): ChatClient {
    if (!_chatClient) {
        _chatClient = {
            messageActions: createMessageActionsAdapter(),
            inputBridge: createChatInputBridgeAdapter(),
        };
    }
    return _chatClient;
}

let _editorClient: EditorClient | null = null;
function getEditorClient(): EditorClient {
    if (!_editorClient) {
        _editorClient = {
            toolbar: createEditorToolbarAdapter(),
            nodes: createEditorNodesAdapter(),
            marks: createEditorMarksAdapter(),
            extensions: createEditorExtensionsAdapter(),
            loader: createEditorLoaderAdapter(),
        };
    }
    return _editorClient;
}

let _paneClient: PaneClient | null = null;
function getPaneClient(): PaneClient {
    if (!_paneClient) {
        _paneClient = {
            apps: createPaneAppsAdapter(),
            manager: createMultiPaneAdapter(),
        };
    }
    return _paneClient;
}

let _projectClient: ProjectClient | null = null;
function getProjectClient(): ProjectClient {
    if (!_projectClient) {
        _projectClient = {
            treeActions: createProjectTreeActionsAdapter(),
        };
    }
    return _projectClient;
}

let _threadClient: ThreadClient | null = null;
function getThreadClient(): ThreadClient {
    if (!_threadClient) {
        _threadClient = {
            historyActions: createThreadHistoryActionsAdapter(),
        };
    }
    return _threadClient;
}

let _documentClient: DocumentClient | null = null;
function getDocumentClient(): DocumentClient {
    if (!_documentClient) {
        _documentClient = {
            historyActions: createDocumentHistoryActionsAdapter(),
        };
    }
    return _documentClient;
}

let _toolsAdapter: ToolsAdapter | null = null;
function getToolsAdapter(): ToolsAdapter {
    if (!_toolsAdapter) {
        _toolsAdapter = createToolsAdapter();
    }
    return _toolsAdapter;
}

let _hooksAdapter: HooksAdapter | null = null;
function getHooksAdapter(): HooksAdapter {
    if (!_hooksAdapter) {
        _hooksAdapter = createHooksAdapter();
    }
    return _hooksAdapter;
}

