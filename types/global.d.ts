import type { RegisteredPaneApp } from '~/composables/core/usePaneApps';
import type { RegisteredSidebarPage } from '~/composables/sidebar/useSidebarPages';
import type { MultiPaneApi, ThumbCache } from '~/types/chat-internal';

declare global {
    interface Window {
        __or3PaneAppsRegistry?: Map<string, RegisteredPaneApp>;
        __or3SidebarPagesRegistry?: Map<string, RegisteredSidebarPage>;
    }

    var __or3PaneAppsRegistry: Map<string, RegisteredPaneApp> | undefined;
    var __or3SidebarPagesRegistry:
        | Map<string, RegisteredSidebarPage>
        | undefined;
    var __or3MultiPaneApi: MultiPaneApi | undefined;
    var __or3ThumbCache: ThumbCache | undefined;
}

export {};
