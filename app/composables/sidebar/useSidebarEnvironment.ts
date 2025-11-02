import { provide, inject, computed, type Ref, type InjectionKey } from 'vue';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';

export interface SidebarMultiPaneApi {
    openApp: (appId: string, opts?: { initialRecordId?: string }) => Promise<void>;
    openChat: (threadId?: string) => Promise<void>;
    openDoc: (documentId?: string) => Promise<void>;
    closePane: (index: number) => Promise<void> | void;
    setActive: (index: number) => void;
    panes: Ref<any[]>;
    activePaneId: Ref<string | null>;
    updatePane: (index: number, updates: Partial<any>) => void;
}

export interface SidebarEnvironment {
    getMultiPane(): SidebarMultiPaneApi;
    getPanePluginApi(): any; // Will be typed when we create the adapter
    getProjects(): Ref<any[]>;
    getThreads(): Ref<any[]>;
    getDocuments(): Ref<any[]>;
    getSections(): Ref<any>;
    getSidebarQuery(): Ref<string>;
    setSidebarQuery(value: string): void;
    getActiveSections(): Ref<{
        projects: boolean;
        chats: boolean;
        docs: boolean;
    }>;
    setActiveSections(sections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    }): void;
    getExpandedProjects(): Ref<string[]>;
    setExpandedProjects(projects: string[]): void;
    getActiveThreadIds(): Ref<string[]>;
    setActiveThreadIds(ids: string[]): void;
    getActiveDocumentIds(): Ref<string[]>;
    setActiveDocumentIds(ids: string[]): void;
    getSidebarFooterActions(): Ref<any[]>;
}

export const SidebarEnvironmentKey: InjectionKey<SidebarEnvironment> = Symbol('SidebarEnvironment');
export const SidebarPageControlsKey: InjectionKey<SidebarPageControls> = Symbol('SidebarPageControls');

/**
 * Create a trimmed SidebarMultiPaneApi adapter from the full UseMultiPaneApi
 */
export function createSidebarMultiPaneApi(multiPaneApi: UseMultiPaneApi): SidebarMultiPaneApi {
    return {
        openApp: multiPaneApi.newPaneForApp,
        openChat: async (threadId?: string) => {
            const index = multiPaneApi.panes.value.length;
            multiPaneApi.addPane();
            if (threadId) {
                await multiPaneApi.setPaneThread(index, threadId);
            }
        },
        openDoc: async (_documentId?: string) => {
            // Current multi-pane API does not expose direct document helpers.
            // Adding a new pane maintains parity with the legacy behaviour
            // (actual document selection handled elsewhere).
            multiPaneApi.addPane();
        },
        closePane: multiPaneApi.closePane,
        setActive: multiPaneApi.setActive,
        panes: multiPaneApi.panes,
        activePaneId: computed(() => {
            const activeIndex = multiPaneApi.activePaneIndex.value;
            const pane = multiPaneApi.panes.value[activeIndex];
            return pane?.id || null;
        }),
        updatePane: multiPaneApi.updatePane,
    };
}

/**
 * Provide sidebar environment to child components
 */
export function provideSidebarEnvironment(environment: SidebarEnvironment) {
    provide(SidebarEnvironmentKey, environment);
}

/**
 * Inject sidebar environment in child components
 */
export function useSidebarEnvironment(): SidebarEnvironment {
    const environment = inject(SidebarEnvironmentKey);
    if (!environment) {
        throw new Error('useSidebarEnvironment must be used within a component that provides SidebarEnvironment');
    }
    return environment;
}

/**
 * Helper composable for accessing sidebar projects
 */
export function useSidebarProjects() {
    const environment = useSidebarEnvironment();
    return environment.getProjects();
}

/**
 * Helper composable for accessing sidebar threads
 */
export function useSidebarThreads() {
    const environment = useSidebarEnvironment();
    return environment.getThreads();
}

/**
 * Helper composable for accessing sidebar documents
 */
export function useSidebarDocuments() {
    const environment = useSidebarEnvironment();
    return environment.getDocuments();
}

/**
 * Helper composable for accessing sidebar sections
 */
export function useSidebarSections() {
    const environment = useSidebarEnvironment();
    return environment.getSections();
}

/**
 * Helper composable for accessing sidebar query
 */
export function useSidebarQuery() {
    const environment = useSidebarEnvironment();
    const query = environment.getSidebarQuery();
    const setQuery = environment.setSidebarQuery;
    
    return {
        query,
        setQuery,
    };
}

/**
 * Helper composable for accessing active sections
 */
export function useActiveSections() {
    const environment = useSidebarEnvironment();
    const activeSections = environment.getActiveSections();
    const setActiveSections = environment.setActiveSections;
    
    return {
        activeSections,
        setActiveSections,
    };
}

/**
 * Helper composable for accessing expanded projects
 */
export function useExpandedProjects() {
    const environment = useSidebarEnvironment();
    const expandedProjects = environment.getExpandedProjects();
    const setExpandedProjects = environment.setExpandedProjects;
    
    return {
        expandedProjects,
        setExpandedProjects,
    };
}

/**
 * Helper composable for accessing active thread IDs
 */
export function useActiveThreadIds() {
    const environment = useSidebarEnvironment();
    const activeThreadIds = environment.getActiveThreadIds();
    const setActiveThreadIds = environment.setActiveThreadIds;
    
    return {
        activeThreadIds,
        setActiveThreadIds,
    };
}

/**
 * Helper composable for accessing active document IDs
 */
export function useActiveDocumentIds() {
    const environment = useSidebarEnvironment();
    const activeDocumentIds = environment.getActiveDocumentIds();
    const setActiveDocumentIds = environment.setActiveDocumentIds;
    
    return {
        activeDocumentIds,
        setActiveDocumentIds,
    };
}

/**
 * Helper composable for accessing sidebar footer actions
 */
export function useSidebarFooterActions() {
    const environment = useSidebarEnvironment();
    return environment.getSidebarFooterActions();
}

/**
 * Helper composable for accessing multi-pane API
 */
export function useSidebarMultiPane() {
    const environment = useSidebarEnvironment();
    return environment.getMultiPane();
}

/**
 * Helper composable for accessing pane plugin API
 */
export function useSidebarPostsApi() {
    const environment = useSidebarEnvironment();
    return environment.getPanePluginApi();
}

/**
 * Helper composable for page controls
 */
export interface SidebarPageControls {
    pageId: string;
    isActive: boolean;
    setActivePage: (id: string) => Promise<boolean>;
    resetToDefault: () => Promise<boolean>;
}

export function useSidebarPageControls(): SidebarPageControls {
    const controls = inject(SidebarPageControlsKey);
    if (!controls) {
        throw new Error('useSidebarPageControls must be used within a component that provides SidebarPageControls');
    }
    return controls;
}

export function provideSidebarPageControls(controls: SidebarPageControls) {
    provide(SidebarPageControlsKey, controls);
}
