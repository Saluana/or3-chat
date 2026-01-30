import './import-meta.d.ts';
import type { Ref } from 'vue';
import type { RegisteredPaneApp } from '~/composables/core/usePaneApps';
import type { RegisteredSidebarPage } from '~/composables/sidebar/useSidebarPages';
import type { MultiPaneApi, ThumbCache } from './chat-internal';
import type { UserThemeOverrides } from '~/core/theme/user-overrides-types';
import type {
    DashboardPlugin,
    DashboardPluginPage,
} from '~/composables/dashboard/useDashboardPlugins';
import type {
    EditorExtension,
    EditorMark,
    EditorNode,
} from '~/composables/editor/useEditorNodes';
import type { EditorToolbarButton } from '~/composables/editor/useEditorToolbar';
import type { ToolRegistryState } from '~/utils/chat/tool-registry';

// Admin Dashboard Types
// Keep in sync with server/admin/stores/types.ts

/** Workspace member information for admin dashboard */
export interface WorkspaceMemberInfo {
    userId: string;
    email?: string;
    role: 'owner' | 'editor' | 'viewer';
}

/** Workspace summary for list views in admin dashboard */
export interface WorkspaceSummary {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    deleted: boolean;
    deletedAt?: number;
    ownerUserId?: string;
    ownerEmail?: string;
    memberCount: number;
}

/** Admin user information */
export interface AdminUserInfo {
    userId: string;
    email?: string;
    displayName?: string;
    createdAt: number;
}

declare global {
    type ActivePluginContext = { pluginId: string | null | undefined };

    interface ChatInputBridge {
        registry: Ref<
            Array<{
                paneId: string;
                api: { setText(t: string): void; triggerSend(): void };
            }>
        >;
        programmaticSend: (paneId: string, text: string) => boolean;
        hasPane: (paneId: string) => boolean;
    }

    type PanePendingPrompts = Record<string, string | null>;

    type UserThemeOverridesStore = {
        light: Ref<UserThemeOverrides>;
        dark: Ref<UserThemeOverrides>;
        activeMode: Ref<'light' | 'dark'>;
        loaded: boolean;
    };

    type ThemeBackgroundTokenCache = Map<string, string>;

    interface Window {
        __or3PaneAppsRegistry?: Map<string, RegisteredPaneApp>;
        __or3SidebarPagesRegistry?: Map<string, RegisteredSidebarPage>;
        __or3ChatInputBridge?: ChatInputBridge;
        __or3PanePendingPrompts?: PanePendingPrompts;
        __or3UserThemeOverrides?: UserThemeOverridesStore;
        __or3ActivePluginContext?: ActivePluginContext;
        __or3ThemeBackgroundTokenCache?: ThemeBackgroundTokenCache;
        __or3DashboardPluginsRegistry?: Map<string, DashboardPlugin>;
        __or3DashboardPluginPagesRegistry?: Map<
            string,
            Map<string, DashboardPluginPage>
        >;
        __or3EditorNodesRegistry?: Map<string, EditorNode>;
        __or3EditorMarksRegistry?: Map<string, EditorMark>;
        __or3EditorExtensionsRegistry?: Map<string, EditorExtension>;
        __or3EditorToolbarRegistry?: Map<string, EditorToolbarButton>;
        __or3ToolRegistry?: ToolRegistryState;
    }

    var __or3PaneAppsRegistry: Map<string, RegisteredPaneApp> | undefined;
    var __or3SidebarPagesRegistry:
        | Map<string, RegisteredSidebarPage>
        | undefined;
    var __or3MultiPaneApi: MultiPaneApi | undefined;
    var __or3ThumbCache: ThumbCache | undefined;
    var __or3ChatInputBridge: ChatInputBridge | undefined;
    var __or3PanePendingPrompts: PanePendingPrompts | undefined;
    var __or3UserThemeOverrides: UserThemeOverridesStore | undefined;
    var __or3ActivePluginContext: ActivePluginContext | undefined;
    var __or3ThemeBackgroundTokenCache:
        | ThemeBackgroundTokenCache
        | undefined;
    var __OR3_APP_INIT_FIRED__: boolean | undefined;
    var __or3DashboardPluginsRegistry:
        | Map<string, DashboardPlugin>
        | undefined;
    var __or3DashboardPluginPagesRegistry:
        | Map<string, Map<string, DashboardPluginPage>>
        | undefined;
    var __or3EditorNodesRegistry: Map<string, EditorNode> | undefined;
    var __or3EditorMarksRegistry: Map<string, EditorMark> | undefined;
    var __or3EditorExtensionsRegistry:
        | Map<string, EditorExtension>
        | undefined;
    var __or3EditorToolbarRegistry:
        | Map<string, EditorToolbarButton>
        | undefined;
    var __or3ToolRegistry: ToolRegistryState | undefined;
}

export {};
