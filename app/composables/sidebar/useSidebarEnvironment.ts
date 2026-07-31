/**
 * @module app/composables/sidebar/useSidebarEnvironment
 *
 * Purpose:
 * Defines and exposes the sidebar environment contract for child components.
 *
 * Responsibilities:
 * - Provides injection keys for sidebar state and controls
 * - Adapts multi-pane APIs for sidebar usage
 * - Offers convenience composables for common sidebar data
 *
 * Non-responsibilities:
 * - Does not implement sidebar UI or rendering
 * - Does not fetch or persist data on its own
 */
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
 * `SidebarPageControls`
 *
 * Purpose:
 * Describes the API for switching and resetting sidebar pages.
 *
 * Behavior:
 * Exposes the active page ID plus activation helpers.
 *
 * Constraints:
 * - Intended to be provided via Vue injection
 *
 * Non-Goals:
 * - Does not define how pages are rendered
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
 * `SidebarPageControlsKey`
 *
 * Purpose:
 * Provides an injection key for `SidebarPageControls`.
 *
 * Constraints:
 * - Must match the key used by `provideSidebarPageControls`
 */
export const SidebarPageControlsKey: InjectionKey<SidebarPageControls> = Symbol(
    'SidebarPageControls'
);

/**
 * `provideSidebarPageControls`
 *
 * Purpose:
 * Makes sidebar page controls available to descendant components.
 *
 * Behavior:
 * Registers controls using the SidebarPageControls injection key.
 *
 * Constraints:
 * - Should be called in a parent setup context
 *
 * Non-Goals:
 * - Does not create controls; it only provides them
 */
export function provideSidebarPageControls(controls: SidebarPageControls) {
    provide(SidebarPageControlsKey, controls);
}

/**
 * `SidebarMultiPaneApi`
 *
 * Purpose:
 * Defines the subset of pane operations needed by the sidebar.
 *
 * Behavior:
 * Provides helper methods for opening apps, chats, and documents and for
 * manipulating pane state.
 *
 * Constraints:
 * - Wraps the full `UseMultiPaneApi`
 *
 * Non-Goals:
 * - Does not expose every multi-pane capability
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
 * Interface defining which sidebar sections are currently active/visible.
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
 * `SidebarEnvironment`
 *
 * Purpose:
 * Defines the full sidebar environment contract exposed via injection.
 *
 * Behavior:
 * Provides accessors for data, UI state, and registry-driven actions.
 *
 * Constraints:
 * - Consumers are expected to call through the provided accessors
 *
 * Non-Goals:
 * - Does not mandate how data is stored or fetched
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
 * `SidebarEnvironmentKey`
 *
 * Purpose:
 * Provides an injection key for `SidebarEnvironment`.
 *
 * Constraints:
 * - Must match the key used by `provideSidebarEnvironment`
 */
export const SidebarEnvironmentKey: InjectionKey<SidebarEnvironment> =
    Symbol('SidebarEnvironment');

/**
 * `createSidebarMultiPaneApi`
 *
 * Purpose:
 * Adapts the full multi-pane API to a sidebar-focused interface.
 *
 * Behavior:
 * Wraps pane operations and exposes only the methods the sidebar requires.
 *
 * Constraints:
 * - Requires a valid `UseMultiPaneApi` instance
 *
 * Non-Goals:
 * - Does not persist or restore pane state
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
 * `provideSidebarEnvironment`
 *
 * Purpose:
 * Makes the sidebar environment available to descendant components.
 *
 * Behavior:
 * Registers the environment under the SidebarEnvironment injection key.
 *
 * Constraints:
 * - Should be called in a parent setup context
 *
 * Non-Goals:
 * - Does not construct the environment object
 */
export function provideSidebarEnvironment(environment: SidebarEnvironment) {
    provide(SidebarEnvironmentKey, environment);
}

/**
 * `useSidebarEnvironment`
 *
 * Purpose:
 * Retrieves the sidebar environment from Vue injection.
 *
 * Behavior:
 * Throws an error when no environment has been provided.
 *
 * Constraints:
 * - Must be called inside a component tree that provided the environment
 *
 * Non-Goals:
 * - Does not supply a default environment
 *
 * @throws Error when used outside of a provider.
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
 * `useSidebarProjects`
 *
 * Purpose:
 * Provides access to the reactive projects list.
 *
 * Behavior:
 * Returns the projects reference from the sidebar environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not fetch projects on its own
 */
export function useSidebarProjects() {
    const environment = useSidebarEnvironment();
    return environment.getProjects();
}

/**
 * `useSidebarThreads`
 *
 * Purpose:
 * Provides access to the reactive threads list.
 *
 * Behavior:
 * Returns the threads reference from the sidebar environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not fetch threads on its own
 */
export function useSidebarThreads() {
    const environment = useSidebarEnvironment();
    return environment.getThreads();
}

/**
 * `useSidebarDocuments`
 *
 * Purpose:
 * Provides access to the reactive documents list.
 *
 * Behavior:
 * Returns the documents reference from the sidebar environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not fetch documents on its own
 */
export function useSidebarDocuments() {
    const environment = useSidebarEnvironment();
    return environment.getDocuments();
}

/**
 * `useSidebarQuery`
 *
 * Purpose:
 * Provides access to the sidebar search query state.
 *
 * Behavior:
 * Returns the query ref and a setter that forwards to the environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not perform search itself
 */
export function useSidebarQuery() {
    const environment = useSidebarEnvironment();
    const query = environment.getSidebarQuery();

    return {
        query,
        setQuery: (q: string) => environment.setSidebarQuery(q),
    };
}

/**
 * `useActiveSections`
 *
 * Purpose:
 * Reads and updates which sidebar sections are active.
 *
 * Behavior:
 * Returns the active sections ref and a setter that updates the environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not persist section state
 */
export function useActiveSections() {
    const environment = useSidebarEnvironment();
    const activeSections = environment.getActiveSections();

    return {
        activeSections,
        setActiveSections: (sections: ActiveSections) =>
            environment.setActiveSections(sections),
    };
}

/**
 * `useExpandedProjects`
 *
 * Purpose:
 * Reads and updates which projects are expanded in the sidebar.
 *
 * Behavior:
 * Returns the expanded project IDs ref and a setter that updates the environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not persist expansion state
 */
export function useExpandedProjects() {
    const environment = useSidebarEnvironment();
    const expandedProjects = environment.getExpandedProjects();

    return {
        expandedProjects,
        setExpandedProjects: (projects: string[]) =>
            environment.setExpandedProjects(projects),
    };
}

/**
 * `useActiveThreadIds`
 *
 * Purpose:
 * Reads and updates the active thread IDs for sidebar selection state.
 *
 * Behavior:
 * Returns the active thread IDs ref and a setter that updates the environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not validate thread existence
 */
export function useActiveThreadIds() {
    const environment = useSidebarEnvironment();
    const activeThreadIds = environment.getActiveThreadIds();

    return {
        activeThreadIds,
        setActiveThreadIds: (ids: string[]) =>
            environment.setActiveThreadIds(ids),
    };
}

/**
 * `useActiveDocumentIds`
 *
 * Purpose:
 * Reads and updates the active document IDs for sidebar selection state.
 *
 * Behavior:
 * Returns the active document IDs ref and a setter that updates the environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not validate document existence
 */
export function useActiveDocumentIds() {
    const environment = useSidebarEnvironment();
    const activeDocumentIds = environment.getActiveDocumentIds();

    return {
        activeDocumentIds,
        setActiveDocumentIds: (ids: string[]) =>
            environment.setActiveDocumentIds(ids),
    };
}

/**
 * `useSidebarMultiPane`
 *
 * Purpose:
 * Provides access to the sidebar-friendly multi-pane API adapter.
 *
 * Behavior:
 * Returns the adapter from the sidebar environment.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not create a multi-pane API instance
 */
export function useSidebarMultiPane(): SidebarMultiPaneApi {
    const environment = useSidebarEnvironment();
    return environment.getMultiPane();
}

/**
 * `useSidebarPostsApi`
 *
 * Purpose:
 * Provides access to the pane plugin API from the sidebar environment.
 *
 * Behavior:
 * Returns the pane plugin API or null when unavailable.
 *
 * Constraints:
 * - Requires a provided sidebar environment
 *
 * Non-Goals:
 * - Does not initialize plugin APIs
 */
export function useSidebarPostsApi(): PanePluginApi | null {
    const environment = useSidebarEnvironment();
    return environment.getPanePluginApi();
}
