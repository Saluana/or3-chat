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

/**
 * Controls for managing sidebar page state and navigation.
 * Provides methods to switch between different sidebar pages and reset to defaults.
 */
export interface SidebarPageControls {
    /** Current active page ID, or null if no page is active */
    pageId: string | null;
    /** Whether the current page is active */
    isActive: boolean;
    /** Set a specific page as active by ID */
    setActivePage: (id: string) => Promise<boolean>;
    /** Reset to the default page */
    resetToDefault: () => Promise<boolean>;
}

/**
 * Injection key for SidebarPageControls
 */
export const SidebarPageControlsKey: InjectionKey<SidebarPageControls> = Symbol(
    'SidebarPageControls'
);

/**
 * Provide sidebar page controls to child components
 * @param controls - The sidebar page controls instance
 */
export function provideSidebarPageControls(controls: SidebarPageControls) {
    provide(SidebarPageControlsKey, controls);
}

/**
 * Multi-pane API adapter for sidebar operations.
 * Provides methods to manage panes, open apps/chats/documents, and control pane state.
 */
export interface SidebarMultiPaneApi {
    /** Open a new pane for a specific app */
    openApp: (
        appId: string,
        opts?: { initialRecordId?: string }
    ) => Promise<void>;
    /** Switch an existing pane to a different app */
    switchToApp: (appId: string, opts?: { recordId?: string }) => Promise<void>;
    /** Open a new chat pane */
    openChat: (threadId?: string) => Promise<void>;
    /** Open a new document pane */
    openDoc: (documentId?: string) => Promise<void>;
    /** Close a pane by index */
    closePane: (index: number) => Promise<void> | void;
    /** Set a pane as active by index */
    setActive: (index: number) => void;
    /** Reactive array of all pane states */
    panes: Ref<PaneState[]>;
    /** Reactive ID of the currently active pane */
    activePaneId: Ref<string | null>;
    /** Update a pane's state */
    updatePane: (index: number, updates: Partial<PaneState>) => void;
}

/**
 * Interface defining which sidebar sections are currently active/visible
 */
interface ActiveSections {
    /** Whether projects section is active */
    projects: boolean;
    /** Whether chats section is active */
    chats: boolean;
    /** Whether documents section is active */
    docs: boolean;
}

/**
 * Main sidebar environment interface providing access to all sidebar data and operations.
 * Acts as a central hub for sidebar state management and API access.
 */
export interface SidebarEnvironment {
    /** Get the multi-pane API for pane management */
    getMultiPane(): SidebarMultiPaneApi;
    /** Get the pane plugin API for custom pane operations */
    getPanePluginApi(): PanePluginApi | null;
    /** Get reactive projects array */
    getProjects(): Ref<Project[]>;
    /** Get reactive threads array */
    getThreads(): Ref<Thread[]>;
    /** Get reactive documents array */
    getDocuments(): Ref<Post[]>;
    /** Get computed sidebar section groups */
    getSections(): ComputedRef<SidebarSectionGroups>;
    /** Get reactive sidebar search query */
    getSidebarQuery(): Ref<string>;
    /** Set the sidebar search query */
    setSidebarQuery(value: string): void;
    /** Get reactive active sections state */
    getActiveSections(): Ref<ActiveSections>;
    /** Set which sections are active */
    setActiveSections(sections: ActiveSections): void;
    /** Get reactive array of expanded project IDs */
    getExpandedProjects(): Ref<string[]>;
    /** Set which projects are expanded */
    setExpandedProjects(projects: string[]): void;
    /** Get reactive array of active thread IDs */
    getActiveThreadIds(): Ref<string[]>;
    /** Set which threads are marked as active */
    setActiveThreadIds(ids: string[]): void;
    /** Get reactive array of active document IDs */
    getActiveDocumentIds(): Ref<string[]>;
    /** Set which documents are marked as active */
    setActiveDocumentIds(ids: string[]): void;
    /** Get computed sidebar footer actions */
    getSidebarFooterActions(): ComputedRef<SidebarFooterActionEntry[]>;
}

/**
 * Injection key for SidebarEnvironment
 */
export const SidebarEnvironmentKey: InjectionKey<SidebarEnvironment> =
    Symbol('SidebarEnvironment');

/**
 * Creates a simplified SidebarMultiPaneApi adapter from the full UseMultiPaneApi.
 * Trims down the API to only the methods needed for sidebar operations.
 * 
 * @param multiPaneApi - The full multi-pane API from useMultiPane
 * @returns A simplified API adapter for sidebar usage
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
 * Provide sidebar environment to child components.
 * Should be called in a parent component to make the environment available to descendants.
 * 
 * @param environment - The sidebar environment instance to provide
 */
export function provideSidebarEnvironment(environment: SidebarEnvironment) {
    provide(SidebarEnvironmentKey, environment);
}

/**
 * Inject and return the sidebar environment from the current component context.
 * Must be used within a component tree where provideSidebarEnvironment was called.
 * 
 * @returns The SidebarEnvironment instance
 * @throws Error if used outside of a provided environment
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
 * Composable for accessing the projects list from the sidebar environment.
 * 
 * @returns Reactive reference to the projects array
 */
export function useSidebarProjects() {
    const environment = useSidebarEnvironment();
    return environment.getProjects();
}

/**
 * Composable for accessing the threads list from the sidebar environment.
 * 
 * @returns Reactive reference to the threads array
 */
export function useSidebarThreads() {
    const environment = useSidebarEnvironment();
    return environment.getThreads();
}

/**
 * Composable for accessing the documents list from the sidebar environment.
 * 
 * @returns Reactive reference to the documents array
 */
export function useSidebarDocuments() {
    const environment = useSidebarEnvironment();
    return environment.getDocuments();
}

/**
 * Composable for accessing and managing the sidebar search query.
 * 
 * @returns Object containing the reactive query and setter function
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
 * Composable for accessing and managing active sidebar sections.
 * Controls which sections (projects, chats, docs) are currently visible.
 * 
 * @returns Object containing the active sections state and setter function
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
 * Composable for accessing and managing expanded project states.
 * Controls which projects show their nested content in the sidebar.
 * 
 * @returns Object containing the expanded projects array and setter function
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
 * Composable for accessing and managing active thread IDs.
 * Controls which threads are marked as active/selected in the sidebar.
 * 
 * @returns Object containing the active thread IDs array and setter function
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
 * Composable for accessing and managing active document IDs.
 * Controls which documents are marked as active/selected in the sidebar.
 * 
 * @returns Object containing the active document IDs array and setter function
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
 * Composable for accessing the multi-pane API from the sidebar environment.
 * Provides pane management functionality for sidebar operations.
 * 
 * @returns The SidebarMultiPaneApi instance
 */
export function useSidebarMultiPane(): SidebarMultiPaneApi {
    const environment = useSidebarEnvironment();
    return environment.getMultiPane();
}

/**
 * Composable for accessing the pane plugin API from the sidebar environment.
 * Provides access to custom pane plugin functionality.
 * 
 * @returns The PanePluginApi instance or null if not available
 */
export function useSidebarPostsApi(): PanePluginApi | null {
    const environment = useSidebarEnvironment();
    return environment.getPanePluginApi();
}
