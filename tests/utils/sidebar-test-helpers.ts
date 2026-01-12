/**
 * Shared test helpers for sidebar-related tests
 * Provides common utilities for mocking sidebar environment and testing sidebar components
 */

import { ref, computed, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { vi } from 'vitest';
import type {
    SidebarEnvironment,
    SidebarPageControls,
    SidebarMultiPaneApi,
} from '../../app/composables/sidebar/useSidebarEnvironment';
import type { SidebarPageDef } from '../../app/composables/sidebar/useSidebarPages';
import type {
    SidebarFooterActionEntry,
    SidebarSectionGroups,
} from '../../app/composables/sidebar/useSidebarSections';
import type { PanePluginApi } from '../../app/plugins/pane-plugin-api.client';
import type { Project, Thread, Post } from '../../app/db/schema';
import type { PaneState } from '../../app/composables/core/useMultiPane';
import {
    provideSidebarEnvironment,
    provideSidebarPageControls,
} from '../../app/composables/sidebar/useSidebarEnvironment';
import { registerSidebarPage } from '../../app/composables/sidebar/registerSidebarPage';

const DEFAULT_TS = 1_700_000_000;

export function createMockProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'project-1',
        name: 'Project 1',
        description: null,
        data: {},
        created_at: DEFAULT_TS,
        updated_at: DEFAULT_TS,
        deleted: false,
        clock: 0,
        ...overrides,
    };
}

export function createMockThread(overrides: Partial<Thread> = {}): Thread {
    return {
        id: 'thread-1',
        title: 'Thread 1',
        created_at: DEFAULT_TS,
        updated_at: DEFAULT_TS,
        last_message_at: null,
        parent_thread_id: null,
        anchor_message_id: null,
        anchor_index: null,
        branch_mode: null,
        status: 'ready',
        deleted: false,
        pinned: false,
        clock: 0,
        forked: false,
        project_id: null,
        system_prompt_id: null,
        ...overrides,
    };
}

export function createMockPost(overrides: Partial<Post> = {}): Post {
    return {
        id: 'post-1',
        title: 'Test Post',
        content: 'Test content',
        postType: 'doc',
        created_at: DEFAULT_TS,
        updated_at: DEFAULT_TS,
        deleted: false,
        meta: null,
        file_hashes: null,
        clock: 0,
        ...overrides,
    };
}

export function createMockPanePluginApi(): PanePluginApi {
    return {
        sendMessage: vi.fn().mockResolvedValue({
            ok: true,
            messageId: 'message-1',
            threadId: 'thread-1',
        }),
        updateDocumentContent: vi.fn().mockReturnValue({ ok: true }),
        patchDocumentContent: vi.fn().mockReturnValue({ ok: true }),
        setDocumentTitle: vi.fn().mockReturnValue({ ok: true }),
        getActivePaneData: vi
            .fn()
            .mockReturnValue({ ok: true, paneId: 'pane-1', mode: 'test' }),
        getPanes: vi
            .fn()
            .mockReturnValue({ ok: true, panes: [], activeIndex: 0 }),
        posts: {
            create: vi.fn().mockResolvedValue({ ok: true, id: 'post-1' }),
            get: vi
                .fn()
                .mockResolvedValue({ ok: true, post: createMockPost() }),
            update: vi.fn().mockResolvedValue({ ok: true }),
            delete: vi.fn().mockResolvedValue({ ok: true }),
            listByType: vi.fn().mockResolvedValue({ ok: true, posts: [] }),
        },
    };
}

export function createMockSidebarSections(): SidebarSectionGroups {
    return {
        top: [],
        main: [],
        bottom: [],
    };
}

export function createMockSidebarFooterActions(): SidebarFooterActionEntry[] {
    return [];
}

export function createMockSidebarMultiPane(
    overrides: Partial<SidebarMultiPaneApi & { panes: Ref<PaneState[]> }> = {}
): SidebarMultiPaneApi {
    const panesRef = overrides.panes ?? ref<PaneState[]>([]);
    const base: SidebarMultiPaneApi = {
        openApp: vi.fn().mockResolvedValue(undefined),
        switchToApp: vi.fn().mockResolvedValue(undefined),
        openChat: vi.fn().mockResolvedValue(undefined),
        openDoc: vi.fn().mockResolvedValue(undefined),
        closePane: vi.fn(),
        setActive: vi.fn(),
        panes: panesRef,
        activePaneId: ref<string | null>(null),
        updatePane: vi.fn(),
    };

    return {
        ...base,
        ...overrides,
        panes: panesRef,
    };
}

/**
 * Creates a mock sidebar environment for testing
 */
export function createMockSidebarEnvironment(
    overrides: Partial<SidebarEnvironment> = {}
): SidebarEnvironment {
    const projects = ref<Project[]>([createMockProject()]);
    const threads = ref<Thread[]>([createMockThread()]);
    const documents = ref<Post[]>([createMockPost()]);
    const sections = computed<SidebarSectionGroups>(() =>
        createMockSidebarSections()
    );
    const sidebarQuery = ref('');
    const activeSections = ref({ projects: true, chats: true, docs: true });
    const expandedProjects = ref<string[]>([]);
    const activeThreadIds = ref<string[]>([]);
    const activeDocumentIds = ref<string[]>([]);
    const footerActions = computed<SidebarFooterActionEntry[]>(() =>
        createMockSidebarFooterActions()
    );

    const base: SidebarEnvironment = {
        getMultiPane: () => createMockSidebarMultiPane(),
        getPanePluginApi: () => createMockPanePluginApi(),
        getProjects: () => projects,
        getThreads: () => threads,
        getDocuments: () => documents,
        getSections: () => sections,
        getSidebarQuery: () => sidebarQuery,
        setSidebarQuery: vi.fn(),
        getActiveSections: () => activeSections,
        setActiveSections: vi.fn(),
        getExpandedProjects: () => expandedProjects,
        setExpandedProjects: vi.fn(),
        getActiveThreadIds: () => activeThreadIds,
        setActiveThreadIds: vi.fn(),
        getActiveDocumentIds: () => activeDocumentIds,
        setActiveDocumentIds: vi.fn(),
        getSidebarFooterActions: () => footerActions,
    };

    return {
        ...base,
        ...overrides,
    };
}

/**
 * Creates mock sidebar page controls for testing
 */
export function createMockSidebarPageControls(
    initialPageId: string = 'sidebar-home'
): SidebarPageControls & { __activationLog: string[] } {
    const pageIdRef = ref<string | null>(initialPageId);
    const isActiveRef = ref(true);
    const activationLog: string[] = [];

    return {
        get pageId() {
            return pageIdRef.value;
        },
        set pageId(value: string | null) {
            pageIdRef.value = value;
        },
        get isActive() {
            return isActiveRef.value;
        },
        setActivePage: vi.fn().mockImplementation(async (id: string) => {
            // Mock implementation that simulates page switching
            const previousId = pageIdRef.value;
            pageIdRef.value = id;
            activationLog.push(`switch:${previousId}->${id}`);
            return true;
        }),
        resetToDefault: vi.fn().mockImplementation(async () => {
            pageIdRef.value = 'sidebar-home';
            return true;
        }),
        // Helper for tests to access activation log
        __activationLog: activationLog,
    };
}

/**
 * Provides a complete mock sidebar environment for Vue components
 */
export function provideMockSidebarEnvironment(
    environment?: Partial<SidebarEnvironment>,
    controls?: Partial<SidebarPageControls & { __activationLog: string[] }>
) {
    const mockEnv = { ...createMockSidebarEnvironment(), ...environment };
    const mockControls = { ...createMockSidebarPageControls(), ...controls };

    provideSidebarEnvironment(mockEnv);
    provideSidebarPageControls(mockControls);

    return { environment: mockEnv, controls: mockControls };
}

/**
 * Creates a mock sidebar page definition for testing
 */
export function createMockSidebarPage(
    overrides: Partial<SidebarPageDef> = {}
): SidebarPageDef {
    return {
        id: 'test-page',
        label: 'Test Page',
        icon: 'pixelarticons:test',
        component: {
            name: 'TestPage',
            template: '<div data-testid="test-page">Test Page Content</div>',
        },
        ...overrides,
    };
}

/**
 * Registers a test sidebar page with default mocks
 */
export function registerTestPane(
    pageDef?: Partial<SidebarPageDef>
): SidebarPageDef {
    const page = createMockSidebarPage(pageDef);
    registerSidebarPage(page);
    return page;
}

/**
 * Creates a fake post builder for testing posts API
 */
export function createFakePostBuilder(overrides: Partial<Post> = {}) {
    return {
        id: `test-post-${Date.now()}`,
        title: 'Test Post',
        content: 'Test content',
        postType: 'test-post-type',
        created_at: Date.now(),
        updated_at: Date.now(),
        deleted: false,
        meta: { version: '1.0' },
        file_hashes: null,
        ...overrides,
    };
}

/**
 * Creates multiple fake posts for testing lists
 */
export function createFakePosts(
    count: number,
    baseOverrides: Partial<Post> = {}
): Post[] {
    return Array.from({ length: count }, (_, index) =>
        createFakePostBuilder({
            ...baseOverrides,
            id: `test-post-${index}`,
            title: `${baseOverrides.title || 'Test Post'} ${index + 1}`,
        })
    ) as Post[];
}

/**
 * Mounts a Vue component with sidebar environment provided
 */
export function mountWithSidebar<T>(
    component: T,
    options: { global?: { stubs?: Record<string, boolean | object> } } & Record<
        string,
        unknown
    > = {},
    sidebarEnvironment?: Partial<SidebarEnvironment>,
    sidebarControls?: Partial<
        SidebarPageControls & { __activationLog: string[] }
    >
) {
    const { environment, controls } = provideMockSidebarEnvironment(
        sidebarEnvironment,
        sidebarControls
    );

    const existingStubs = options.global?.stubs ?? {};
    const existingGlobal = options.global ?? {};

    return mount(component, {
        global: {
            plugins: [
                {
                    install() {
                        provideSidebarEnvironment(environment);
                        provideSidebarPageControls(controls);
                    },
                },
            ],
            stubs: {
                UIcon: true,
                UButton: true,
                UTooltip: true,
                UCard: true,
                UInput: true,
                UForm: true,
                ...existingStubs,
            },
            ...existingGlobal,
        },
        ...options,
    });
}

/**
 * Creates a mock multi-pane API for testing pane interactions
 */
export function createMockMultiPaneApi() {
    const panes = ref<
        Array<{
            id: string;
            mode: string;
            threadId?: string;
            documentId?: string;
        }>
    >([
        { id: 'pane-1', mode: 'chat', threadId: 'thread-1' },
        { id: 'pane-2', mode: 'doc', documentId: 'doc-1' },
    ]);
    const activePaneId = ref('pane-1');

    return {
        openApp: vi.fn().mockResolvedValue(undefined),
        switchToApp: vi
            .fn()
            .mockImplementation(
                async (appId: string, options?: Record<string, unknown>) => {
                    // Mock switching to app
                    return { success: true, appId, options };
                }
            ),
        openChat: vi.fn().mockResolvedValue(undefined),
        openDoc: vi.fn().mockResolvedValue(undefined),
        closePane: vi.fn(),
        setActive: vi.fn(),
        panes,
        activePaneId,
        updatePane: vi.fn(),
        // Helper for tests
        __addPane: (pane: {
            id: string;
            mode: string;
            threadId?: string;
            documentId?: string;
        }) => panes.value.push(pane),
        __setActive: (paneId: string) => (activePaneId.value = paneId),
    };
}

/**
 * Mocks common composables used in sidebar tests
 */
export function mockSidebarComposables() {
    vi.mock('~/composables/sidebar/useSidebarSearch', () => ({
        useSidebarSearch: () => ({
            query: ref(''),
            threadResults: ref([]),
            projectResults: ref([]),
            documentResults: ref([]),
        }),
    }));

    vi.mock('~/composables/sidebar/useActiveSidebarPage', () => ({
        useActiveSidebarPage: () => ({
            activePageId: ref('sidebar-home'),
            activePageDef: ref({ id: 'sidebar-home', usesDefaultHeader: true }),
            setActivePage: vi.fn().mockResolvedValue(true),
            resetToDefault: vi.fn().mockResolvedValue(true),
        }),
    }));

    vi.mock('~/db', () => ({
        db: {
            threads: {
                orderBy: () => ({
                    reverse: () => ({
                        filter: () => ({ toArray: async () => [] }),
                    }),
                }),
            },
            projects: {
                orderBy: () => ({
                    reverse: () => ({
                        filter: () => ({ toArray: async () => [] }),
                    }),
                }),
            },
            posts: {
                where: () => ({
                    equals: () => ({
                        and: () => ({ toArray: async () => [] }),
                    }),
                }),
            },
        },
        upsert: vi.fn(),
        del: vi.fn(),
        create: vi.fn(),
    }));

    vi.mock('dexie', () => ({
        liveQuery: () => ({
            subscribe: () => ({ unsubscribe() {} }),
        }),
    }));
}

/**
 * Sets up a complete test environment for sidebar tests
 */
export function setupSidebarTestEnvironment() {
    // Clear any existing registry
    const g = globalThis as Record<string, unknown>;
    g.__or3SidebarPagesRegistry = new Map();

    // Mock process.client
    (global as Record<string, unknown>).process = { client: true };

    // Mock composables
    mockSidebarComposables();

    // Register default home page
    registerSidebarPage({
        id: 'sidebar-home',
        label: 'Home',
        icon: 'pixelarticons:home',
        component: {
            name: 'HomePage',
            template:
                '<div data-testid="sidebar-home-page">Home Page Content</div>',
        },
    });
}

/**
 * Creates test data for sidebar components
 */
export const createSidebarTestData = {
    projects: () => [
        { id: 'proj-1', title: 'Project 1', description: 'Test project 1' },
        { id: 'proj-2', title: 'Project 2', description: 'Test project 2' },
    ],

    threads: () => [
        { id: 'thread-1', title: 'Chat 1', projectId: 'proj-1' },
        { id: 'thread-2', title: 'Chat 2', projectId: 'proj-1' },
    ],

    documents: () => [
        { id: 'doc-1', title: 'Document 1', projectId: 'proj-1' },
        { id: 'doc-2', title: 'Document 2', projectId: 'proj-2' },
    ],

    sidebarSections: () => [
        { id: 'sidebar-home', label: 'Home', icon: 'pixelarticons:home' },
    ],
};

export default {
    createMockSidebarEnvironment,
    createMockSidebarPageControls,
    provideMockSidebarEnvironment,
    createMockSidebarPage,
    registerTestPane,
    createFakePostBuilder,
    createFakePosts,
    mountWithSidebar,
    createMockMultiPaneApi,
    mockSidebarComposables,
    setupSidebarTestEnvironment,
    createSidebarTestData,
};
