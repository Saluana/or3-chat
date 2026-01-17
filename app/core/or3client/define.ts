/**
 * OR3 Client Define Helpers
 *
 * Provides type inference helpers for defining registry items.
 * These functions are purely for IDE autocomplete and consistency.
 */

import type {
    SidebarPageDef,
    SidebarSection,
    SidebarFooterAction,
    HeaderAction,
    ComposerAction,
    PaneAppDef,
    DashboardPlugin,
    DashboardPluginPage,
    ChatMessageAction,
    EditorToolbarButton,
    ProjectTreeAction,
    ThreadHistoryAction,
    DocumentHistoryAction,
    ToolDefinition,
} from './types';

/**
 * Helper for type inference when defining a sidebar page.
 * This is purely for IDE autocomplete—it returns the input unchanged.
 *
 * @example
 * const myPage = defineSidebarPage({
 *   id: 'my-page',
 *   label: 'My Page',
 *   icon: 'i-carbon-home',
 *   component: () => import('./MyPage.vue'),
 * });
 */
export function defineSidebarPage(def: SidebarPageDef): SidebarPageDef {
    return def;
}

/**
 * Helper for type inference when defining a sidebar section.
 */
export function defineSidebarSection(def: SidebarSection): SidebarSection {
    return def;
}

/**
 * Helper for type inference when defining a sidebar footer action.
 */
export function defineSidebarFooterAction(
    def: SidebarFooterAction
): SidebarFooterAction {
    return def;
}

/**
 * Helper for type inference when defining a header action.
 */
export function defineHeaderAction(def: HeaderAction): HeaderAction {
    return def;
}

/**
 * Helper for type inference when defining a composer action.
 */
export function defineComposerAction(def: ComposerAction): ComposerAction {
    return def;
}

/**
 * Helper for type inference when defining a pane app.
 */
export function definePaneApp(def: PaneAppDef): PaneAppDef {
    return def;
}

/**
 * Helper for type inference when defining a dashboard plugin.
 */
export function defineDashboardPlugin(def: DashboardPlugin): DashboardPlugin {
    return def;
}

/**
 * Helper for type inference when defining a dashboard plugin page.
 */
export function defineDashboardPluginPage(
    def: DashboardPluginPage
): DashboardPluginPage {
    return def;
}

/**
 * Helper for type inference when defining a chat message action.
 */
export function defineMessageAction(def: ChatMessageAction): ChatMessageAction {
    return def;
}

/**
 * Helper for type inference when defining an editor toolbar button.
 */
export function defineEditorToolbarButton(
    def: EditorToolbarButton
): EditorToolbarButton {
    return def;
}

/**
 * Helper for type inference when defining a project tree action.
 */
export function defineProjectTreeAction(
    def: ProjectTreeAction
): ProjectTreeAction {
    return def;
}

/**
 * Helper for type inference when defining a thread history action.
 */
export function defineThreadHistoryAction(
    def: ThreadHistoryAction
): ThreadHistoryAction {
    return def;
}

/**
 * Helper for type inference when defining a document history action.
 */
export function defineDocumentHistoryAction(
    def: DocumentHistoryAction
): DocumentHistoryAction {
    return def;
}

/**
 * Helper for type inference when defining an AI tool.
 */
export function defineTool(def: ToolDefinition): ToolDefinition {
    return def;
}

