/**
 * OR3 Client Type Re-exports
 *
 * This file re-exports types from their source modules.
 * DO NOT DUPLICATE TYPE DEFINITIONS - always import from source.
 *
 * This prevents type drift and keeps "source of truth" clear.
 */

// Sidebar types
export type {
    SidebarSection,
    SidebarSectionPlacement,
    SidebarSectionGroups,
    SidebarFooterAction,
    SidebarFooterActionContext,
    SidebarFooterActionEntry,
    ChromeActionColor,
} from '~/composables/sidebar/useSidebarSections';

export type {
    HeaderAction,
    HeaderActionContext,
    HeaderActionEntry,
} from '~/composables/sidebar/useHeaderActions';

export type {
    ComposerAction,
    ComposerActionContext,
    ComposerActionEntry,
} from '~/composables/sidebar/useComposerActions';

export type {
    SidebarPageDef,
    SidebarPageContext,
    SidebarActivateContext,
    RegisteredSidebarPage,
} from '~/composables/sidebar/useSidebarPages';

// Dashboard types
export type {
    DashboardPlugin,
    DashboardPluginPage,
} from '~/composables/dashboard/useDashboardPlugins';

// Pane types
export type {
    PaneAppDef,
    RegisteredPaneApp,
} from '~/composables/core/usePaneApps';

export type {
    UseMultiPaneApi,
    PaneState,
    PaneMode,
    MultiPaneMessage,
} from '~/composables/core/useMultiPane';

// Chat types
export type { ChatMessageAction } from '~/composables/chat/useMessageActions';

// Editor types
export type { EditorToolbarButton } from '~/composables/editor/useEditorToolbar';

export type {
    EditorNode,
    EditorMark,
    EditorExtension,
} from '~/composables/editor/useEditorNodes';

export type {
    LazyEditorNodeFactory,
    LazyEditorMarkFactory,
    LazyEditorExtensionFactory,
    LoadedExtensions,
} from '~/composables/editor/useEditorExtensionLoader';

// Project/Thread/Document action types
export type { ProjectTreeAction } from '~/composables/projects/useProjectTreeActions';
export type { ThreadHistoryAction } from '~/composables/threads/useThreadHistoryActions';
export type { DocumentHistoryAction } from '~/composables/documents/useDocumentHistoryActions';

// Tool types
export type {
    ToolDefinition,
    ToolCall,
} from '~/utils/chat/types';

// Hook types
export type { TypedHookEngine } from '~/core/hooks/typed-hooks';
export type { HookName, InferHookCallback } from '~/core/hooks/hook-types';
