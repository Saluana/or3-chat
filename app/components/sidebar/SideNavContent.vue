<template>
    <div
        id="nav-content-container"
        ref="containerRef"
        class="flex flex-col w-full h-full relative overflow-hidden"
    >
        <!-- Header only shown for pages that use default header -->
        <ClientOnly>
            <SideNavHeader
                id="nav-header"
                v-if="activePageDef?.usesDefaultHeader"
                ref="sideNavHeaderRef"
                :sidebar-query="sidebarQuery"
                :active-sections="activeSections"
                :projects="projects"
                @update:sidebar-query="emit('update:sidebar-query', $event)"
                @update:active-sections="emit('update:active-sections', $event)"
                @new-chat="emit('new-chat')"
                @new-document="emit('new-document', $event)"
                @open-rename="emit('open-rename', $event)"
                @open-rename-project="emit('open-rename-project', $event)"
                @add-to-project="emit('add-to-project', $event)"
                @add-document-to-project="
                    emit('add-document-to-project', $event)
                "
                @add-document-to-project-root="
                    emit('add-document-to-project-root', $event)
                "
            />
        </ClientOnly>

        <!-- Dynamic page content with suspense and keepalive -->
        <ClientOnly>
            <div
                id="nav-scroll-area"
                ref="scrollAreaRef"
                class="flex-1 min-h-0 h-full px-2 flex flex-col gap-3 overflow-hidden"
            >
                <!-- Dynamic page renderer -->
                <Suspense>
                    <template #default>
                        <KeepAlive include="sidebar-home">
                            <component
                                id="page-keepalive"
                                v-if="activePageDef?.keepAlive"
                                :is="activePageComponent"
                                :key="`keepalive-${activePageId}`"
                                v-bind="activePageProps"
                                @vue:mounted="onPageMounted"
                                @vue:unmounted="onPageUnmounted"
                                v-on="forwardedEvents"
                            />
                            <component
                                id="page-no-keepalive"
                                v-else
                                :is="activePageComponent"
                                :key="`no-keepalive-${activePageId}`"
                                v-bind="activePageProps"
                                @vue:mounted="onPageMounted"
                                @vue:unmounted="onPageUnmounted"
                                v-on="forwardedEvents"
                            />
                        </KeepAlive>
                    </template>
                    <template #fallback>
                        <div
                            id="page-loading-fallback"
                            class="flex-1 flex items-center justify-center"
                        >
                            <div class="text-sm opacity-70">
                                Loading page...
                            </div>
                        </div>
                    </template>
                </Suspense>
            </div>
        </ClientOnly>

        <div
            id="nav-bottom-section"
            ref="bottomNavRef"
            class="shrink-0 flex flex-col gap-2"
        >
            <div
                v-if="sidebarFooterActions.length"
                class="footer-actions-wrapper flex flex-wrap gap-2"
            >
                <UTooltip
                    v-for="entry in sidebarFooterActions"
                    :key="`sidebar-footer-${entry.action.id}`"
                    :delay-duration="0"
                    :text="entry.action.tooltip || entry.action.label"
                    class="footer-action-item"
                >
                    <UButton
                        :id="`btn-footer-${entry.action.id}`"
                        v-bind="footerActionButtonProps"
                        :color="(entry.action.color || 'neutral') as any"
                        :square="!entry.action.label"
                        :disabled="entry.disabled"
                        @click="emit('sidebar-footer-action', entry)"
                    >
                        <UIcon
                            :name="entry.action.icon"
                            class="footer-icon w-4 h-4"
                        />
                        <span
                            v-if="entry.action.label"
                            class="footer-label ml-1 text-xs font-medium"
                        >
                            {{ entry.action.label }}
                        </span>
                    </UButton>
                </UTooltip>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef, type Component } from 'vue';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import {
    provideSidebarEnvironment,
    createSidebarMultiPaneApi,
    type SidebarEnvironment,
    type SidebarPageControls,
    provideSidebarPageControls,
} from '~/composables/sidebar/useSidebarEnvironment';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import SideNavHeader from '~/components/sidebar/SideNavHeader.vue';
import SidebarHomePage from '~/components/sidebar/SidebarHomePage.vue';
import type { Post, Project } from '~/db';
import type { Document } from '~/db/documents';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import type { SidebarFooterActionEntry } from '~/composables/sidebar/useSidebarSections';

import type { Thread } from '~/db';

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };

const props = defineProps<{
    activeThread?: string;
    items: Thread[];
    projects: SidebarProject[];
    expandedProjects: string[];
    docs: Post[];
    listHeight: number;
    activeSections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    };
    displayThreads: Thread[];
    displayProjects: SidebarProject[];
    displayDocuments?: Post[];
    sidebarQuery: string;
    activeDocumentIds: string[];
    activeThreadIds: string[];
    sidebarFooterActions: SidebarFooterActionEntry[];
    resolvedSidebarSections: {
        top: { id: string; component: Component }[];
        main: { id: string; component: Component }[];
        bottom: { id: string; component: Component }[];
    };
}>();

const emit = defineEmits([
    'update:sidebar-query',
    'update:active-sections',
    'update:expanded-projects',
    'update:active-thread-ids',
    'update:active-document-ids',
    'new-chat',
    'new-document',
    'open-rename',
    'open-rename-project',
    'add-to-project',
    'add-document-to-project',
    'add-chat-to-project',
    'rename-project',
    'delete-project',
    'rename-entry',
    'remove-from-project',
    'chat-selected-from-project',
    'document-selected-from-project',
    'select-thread',
    'rename-thread',
    'delete-thread',
    'add-thread-to-project',
    'select-document',
    'rename-document',
    'delete-document',
    'add-document-to-project-from-list',
    'add-document-to-project-root',
    'sidebar-footer-action',
]);

// Get multi-pane API from the instance initialised in PageShell
const multiPaneApiRef = shallowRef<ReturnType<typeof useMultiPane> | null>(
    (globalThis as any).__or3MultiPaneApi ?? null
);

if (!multiPaneApiRef.value && import.meta.dev) {
    console.warn(
        '[SideNavContent] Waiting for __or3MultiPaneApi initialization'
    );
}

const sidebarMultiPaneApi = multiPaneApiRef.value
    ? createSidebarMultiPaneApi(multiPaneApiRef.value)
    : null;

// Get active page state
const { activePageId, activePageDef, setActivePage, resetToDefault } =
    useActiveSidebarPage();

const projectsRef = computed(() => props.projects);
const threadsRef = computed(() => props.displayThreads);
const documentsRef = computed(() => props.docs);
const sectionsRef = computed(() => props.resolvedSidebarSections);
const sidebarQueryRef = computed(() => props.sidebarQuery);
const activeSectionsRef = computed(() => props.activeSections);
const expandedProjectsRef = computed(() => props.expandedProjects);
const activeThreadIdsRef = computed(() => props.activeThreadIds);
const activeDocumentIdsRef = computed(() => props.activeDocumentIds);
const footerActionsRef = computed(() => props.sidebarFooterActions);

// Footer action button theme props
const footerActionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.footer-action',
        isNuxtUI: true,
    });
    return {
        size: 'xs' as const,
        variant: 'ghost' as const,
        class: 'pointer-events-auto',
        ...(overrides.value as any),
    };
});

// Create environment for child components
const environment: SidebarEnvironment = {
    getMultiPane: () => {
        if (!sidebarMultiPaneApi) {
            throw new Error('Multi-pane API not available');
        }
        return sidebarMultiPaneApi;
    },
    getPanePluginApi: () =>
        (
            globalThis as typeof globalThis & {
                __or3PanePluginApi?: PanePluginApi | null;
            }
        ).__or3PanePluginApi || null,
    getProjects: () => projectsRef,
    getThreads: () => threadsRef,
    getDocuments: () => documentsRef,
    getSections: () => sectionsRef,
    getSidebarQuery: () => sidebarQueryRef,
    setSidebarQuery: (value: string) => emit('update:sidebar-query', value),
    getActiveSections: () => activeSectionsRef,
    setActiveSections: (sections) => emit('update:active-sections', sections),
    getExpandedProjects: () => expandedProjectsRef,
    setExpandedProjects: (projects) =>
        emit('update:expanded-projects', projects),
    getActiveThreadIds: () => activeThreadIdsRef,
    setActiveThreadIds: (ids) => emit('update:active-thread-ids', ids),
    getActiveDocumentIds: () => activeDocumentIdsRef,
    setActiveDocumentIds: (ids) => emit('update:active-document-ids', ids),
    getSidebarFooterActions: () => footerActionsRef,
};

// Provide environment and page controls to child components
provideSidebarEnvironment(environment);

const injectedPageControls: SidebarPageControls = {
    get pageId() {
        return activePageId.value ?? null;
    },
    get isActive() {
        return activePageDef.value?.id === activePageId.value;
    },
    setActivePage,
    resetToDefault,
};

provideSidebarPageControls(injectedPageControls);

// Computed properties for dynamic rendering
const activePageComponent = computed(() => {
    return activePageDef.value?.component || SidebarHomePage;
});

// Props to pass to active page
const activePageProps = computed(() => {
    const pageControlProps = {
        pageId: activePageId.value,
        isActive: true,
        setActivePage,
        resetToDefault,
    };

    // For the home page, pass all the existing props
    if (activePageId.value === 'sidebar-home') {
        return {
            ...props,
            ...pageControlProps,
        };
    }

    // For other pages, pass minimal props + page controls
    return {
        ...pageControlProps,
    };
});

// Forward events from active page to parent
const forwardedEvents = computed(() => {
    const events: Record<string, (payload: any) => void> = {};

    // Forward all existing events
    const eventNames = [
        'add-chat-to-project',
        'add-document-to-project',
        'rename-project',
        'delete-project',
        'rename-entry',
        'remove-from-project',
        'chat-selected-from-project',
        'document-selected-from-project',
        'select-thread',
        'rename-thread',
        'delete-thread',
        'add-thread-to-project',
        'select-document',
        'rename-document',
        'delete-document',
        'add-document-to-project-from-list',
        'add-document-to-project-root',
        'sidebar-footer-action',
    ];

    eventNames.forEach((eventName) => {
        events[eventName] = (payload: any) => emit(eventName as any, payload);
    });

    return events;
});

// Page lifecycle handlers
function onPageMounted(vnode: any) {
    // Could be used for analytics or cleanup
}

function onPageUnmounted(vnode: any) {
    // Could be used for cleanup
}

// Refs for parent component access
const sideNavHeaderRef = ref<InstanceType<typeof SideNavHeader> | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const scrollAreaRef = ref<HTMLElement | null>(null);
const bottomNavRef = ref<HTMLElement | null>(null);

// Expose focusSearchInput to parent components
function focusSearchInput() {
    return sideNavHeaderRef.value?.focusSearchInput?.() ?? false;
}

defineExpose({
    focusSearchInput,
    setActivePage,
    resetToDefault,
    headerElement: computed(() => sideNavHeaderRef.value?.$el as HTMLElement | null),
});
</script>
