import {
    provide,
    inject,
    computed,
    type Ref,
    type InjectionKey,
    type ComputedRef,
} from 'vue';
import type {
    UseMultiPaneApi,
    PaneState,
} from '~/composables/core/useMultiPane';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import type { Project, Thread, Post } from '~/db';
import type {
    SidebarSectionGroups,
    SidebarFooterActionEntry,
} from './useSidebarSections';

export interface SidebarPageControls {
    pageId: string | null;
    isActive: boolean;
    setActivePage: (id: string) => Promise<boolean>;
    resetToDefault: () => Promise<boolean>;
}

export const SidebarPageControlsKey: InjectionKey<SidebarPageControls> = Symbol(
    'SidebarPageControls'
);

export function provideSidebarPageControls(controls: SidebarPageControls) {
    provide(SidebarPageControlsKey, controls);
}

export interface SidebarMultiPaneApi {
    openApp: (
        appId: string,
        opts?: { initialRecordId?: string }
    ) => Promise<void>;
    switchToApp: (appId: string, opts?: { recordId?: string }) => Promise<void>;
    openChat: (threadId?: string) => Promise<void>;
    openDoc: (documentId?: string) => Promise<void>;
    closePane: (index: number) => Promise<void> | void;
    setActive: (index: number) => void;
    panes: Ref<PaneState[]>;
    activePaneId: Ref<string | null>;
    updatePane: (index: number, updates: Partial<PaneState>) => void;
}

interface ActiveSections {
    projects: boolean;
    chats: boolean;
    docs: boolean;
}

export interface SidebarEnvironment {
    getMultiPane(): SidebarMultiPaneApi;
    getPanePluginApi(): PanePluginApi | null;
    getProjects(): Ref<Project[]>;
    getThreads(): Ref<Thread[]>;
    getDocuments(): Ref<Post[]>;
    getSections(): ComputedRef<SidebarSectionGroups>;
    getSidebarQuery(): Ref<string>;
    setSidebarQuery(value: string): void;
    getActiveSections(): Ref<ActiveSections>;
    setActiveSections(sections: ActiveSections): void;
    getExpandedProjects(): Ref<string[]>;
    setExpandedProjects(projects: string[]): void;
    getActiveThreadIds(): Ref<string[]>;
    setActiveThreadIds(ids: string[]): void;
    getActiveDocumentIds(): Ref<string[]>;
    setActiveDocumentIds(ids: string[]): void;
    getSidebarFooterActions(): ComputedRef<SidebarFooterActionEntry[]>;
}

export const SidebarEnvironmentKey: InjectionKey<SidebarEnvironment> =
    Symbol('SidebarEnvironment');

/**
 * Create a trimmed SidebarMultiPaneApi adapter from the full UseMultiPaneApi
 */
export function createSidebarMultiPaneApi(
    multiPaneApi: UseMultiPaneApi
): SidebarMultiPaneApi {
    return {
        openApp: multiPaneApi.newPaneForApp,
        switchToApp: async (appId: string, opts?: { recordId?: string }) => {
            await multiPaneApi.setPaneApp(
                multiPaneApi.activePaneIndex.value,
                appId,
                opts
            );
        },
        openChat: async (threadId?: string) => {
            const index = multiPaneApi.panes.value.length;
            multiPaneApi.addPane();
            if (threadId) {
                await multiPaneApi.setPaneThread(index, threadId);
            }
        },
        openDoc: async (documentId?: string) => {
            const nextIndex = multiPaneApi.panes.value.length;
            multiPaneApi.addPane();
            const pane = multiPaneApi.panes.value[nextIndex];
            if (!pane) return;
            multiPaneApi.updatePane(nextIndex, {
                mode: 'doc',
                documentId: documentId ?? undefined,
                threadId: '',
                messages: [],
            });
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
        throw new Error(
            'useSidebarEnvironment must be used within a component that provides SidebarEnvironment'
        );
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
 * Helper composable for accessing multi-pane API
 */
export function useSidebarMultiPane(): SidebarMultiPaneApi {
    const environment = useSidebarEnvironment();
    return environment.getMultiPane();
}

/**
 * Helper composable for accessing pane plugin API
 */
export function useSidebarPostsApi(): PanePluginApi | null {
    const environment = useSidebarEnvironment();
    return environment.getPanePluginApi();
}
