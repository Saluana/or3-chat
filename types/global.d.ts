import type { RegisteredPaneApp } from '~/composables/core/usePaneApps';
import type { RegisteredSidebarPage } from '~/composables/sidebar/useSidebarPages';

declare global {
    interface Window {
        __or3PaneAppsRegistry?: Map<string, RegisteredPaneApp>;
        __or3SidebarPagesRegistry?: Map<string, RegisteredSidebarPage>;
    }

    var __or3PaneAppsRegistry: Map<string, RegisteredPaneApp> | undefined;
    var __or3SidebarPagesRegistry:
        | Map<string, RegisteredSidebarPage>
        | undefined;
}

export {};
