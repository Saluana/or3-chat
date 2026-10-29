<template>
    <div
        id="nav-collapsed-container"
        class="flex min-w-[63.8px] max-w-[63.8px] flex-col h-full min-h-0 relative bg-[color:var(--md-surface)]/5 dark:bg-transparent backdrop-blur-xs"
    >
        <div id="nav-top-section" class="px-1 py-2 flex min-h-0 flex-col space-y-2 overflow-y-auto overscroll-contain [&>*]:shrink-0">
            <div
                class="new-chat-wrapper flex items-center justify-center w-full pr-0.5"
            >
                <UPopover
                    v-model:open="createOpen"
                    :content="{ side: 'right', align: 'start', sideOffset: 8 }"
                >
                    <UTooltip
                        :delay-duration="0"
                        :disabled="createOpen"
                        :content="{
                            side: 'right',
                        }"
                        text="New"
                    >
                        <UButton
                            v-bind="newChatButtonProps"
                            id="btn-create"
                            aria-label="New"
                            class="flex items-center justify-center"
                        ></UButton>
                    </UTooltip>
                    <template #content>
                        <div
                            id="rail-create-menu"
                            class="or3-action-menu flex flex-col gap-0.5 p-1.5 min-w-[200px]"
                        >
                            <button
                                v-for="item in createItems"
                                :id="`rail-create-${item.kind}`"
                                :key="item.kind"
                                type="button"
                                class="rail-create-item flex items-center gap-3 w-full min-h-[44px] pl-1.5 pr-3 py-1 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[14px] font-medium text-left text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] transition-colors duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)] cursor-pointer focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
                                :class="`page-link-accent-${item.accent}`"
                                @click="onCreate(item.kind)"
                            >
                                <span
                                    class="page-link-icon-container shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                                    :class="item.tone"
                                >
                                    <UIcon
                                        :name="item.icon"
                                        class="w-[18px] h-[18px]"
                                    />
                                </span>
                                <span>{{ item.label }}</span>
                            </button>
                        </div>
                    </template>
                </UPopover>
            </div>

            <ClientOnly>
                <div
                    id="nav-pages-section"
                    class="pt-2 flex flex-col space-y-2 border-t-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-t-[color:var(--md-border-color)]"
                >
                    <UTooltip
                        v-if="showHomePage"
                        id="tooltip-home"
                        :delay-duration="0"
                        :content="{
                            side: 'right',
                        }"
                        text="Home"
                    >
                        <UButton
                            v-bind="
                                activeRailItem === DEFAULT_PAGE_ID
                                    ? pageButtonActiveProps
                                    : pageButtonProps
                            "
                            id="btn-home"
                            class="flex items-center justify-center"
                            :icon="iconPageHome"
                            :aria-pressed="activeRailItem === DEFAULT_PAGE_ID"
                            aria-label="Home"
                            @click="() => handlePageSelect(DEFAULT_PAGE_ID)"
                            @keydown.enter="
                                () => handlePageSelect(DEFAULT_PAGE_ID)
                            "
                            @keydown.space.prevent="
                                () => handlePageSelect(DEFAULT_PAGE_ID)
                            "
                        />
                    </UTooltip>
                    <UTooltip
                        v-if="dashboardEnabled"
                        id="tooltip-dashboard"
                        :delay-duration="0"
                        :content="{
                            side: 'right',
                        }"
                        text="Dashboard"
                    >
                        <UButton
                            v-bind="
                                activeRailItem === DASHBOARD_RAIL_ID
                                    ? pageButtonActiveProps
                                    : pageButtonProps
                            "
                            id="btn-dashboard"
                            class="flex items-center justify-center"
                            :icon="iconDashboard"
                            :aria-pressed="activeRailItem === DASHBOARD_RAIL_ID"
                            aria-label="Dashboard"
                            @click="emit('toggle-dashboard')"
                        />
                    </UTooltip>
                    <div
                        v-for="group in orderedPageGroups"
                        :key="`sidebar-page-group-${group.id}`"
                        class="profile-navigation-group flex flex-col space-y-2"
                        :data-profile-navigation-group="group.id"
                    >
                        <span class="sr-only">{{ group.label }}</span>
                        <UTooltip
                            v-for="page in group.pages"
                            :key="`sidebar-page-btn-${page.id}`"
                            :content="{
                                side: 'right',
                            }"
                            :delay-duration="0"
                            :text="page.label"
                            class="page-nav-item"
                        >
                            <UButton
                                v-bind="
                                    activeRailItem === page.id
                                        ? pageButtonActiveProps
                                        : pageButtonProps
                                "
                                :id="`btn-page-${page.id}`"
                                class="flex items-center justify-center"
                                :aria-pressed="activeRailItem === page.id"
                                :aria-label="page.label"
                                @click="() => handlePageSelect(page.id)"
                                @keydown.enter="() => handlePageSelect(page.id)"
                                @keydown.space.prevent="
                                    () => handlePageSelect(page.id)
                                "
                            >
                                <AppIcon
                                    :image="page.image"
                                    :icon="page.id === 'sidebar-files' ? iconPageFiles : page.icon || iconPageDefault"
                                    :class="page.image ? 'h-7 w-7' : 'h-5 w-5'"
                                />
                            </UButton>
                        </UTooltip>
                    </div>
                </div>
            </ClientOnly>
        </div>
        <div class="sidebar-bottom-section">
            <div
                id="nav-footer-section"
                v-if="sidebarFooterActions.length"
                class="px-1 pb-2 flex flex-col space-y-2"
            >
                <UTooltip
                    v-for="entry in sidebarFooterActions"
                    :key="`sidebar-collapsed-footer-${entry.action.id}`"
                    :delay-duration="0"
                    :text="entry.action.tooltip || entry.action.label"
                    class="footer-action-item"
                >
                    <UButton
                        :id="`btn-footer-${entry.action.id}`"
                        size="md"
                        variant="ghost"
                        :color="(entry.action.color || 'neutral') as any"
                        square
                        :disabled="entry.disabled"
                        class="theme-btn pointer-events-auto flex items-center justify-center gap-1"
                        :ui="{ base: 'theme-btn' }"
                        :aria-label="
                            entry.action.tooltip ||
                            entry.action.label ||
                            entry.action.id
                        "
                        @click="() => handleSidebarFooterAction(entry)"
                    >
                        <UIcon
                            :name="entry.action.icon"
                            class="footer-icon w-5 h-5"
                        />
                        <span
                            v-if="entry.action.label"
                            class="footer-label sr-only"
                        >
                            {{ entry.action.label }}
                        </span>
                    </UButton>
                </UTooltip>
            </div>
            <ClientOnly>
                <SideBottomNav id="bottom-nav" />
            </ClientOnly>
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue';
import { useToast, navigateTo } from '#imports';
import {
    useSidebarFooterActions,
    type SidebarFooterActionEntry,
} from '~/composables/sidebar/useSidebarSections';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import SideBottomNav from './SideBottomNav.vue';
import AppIcon from '~/components/ui/AppIcon.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useOr3Config } from '~/composables/useOr3Config';
import {
    projectProfileItems,
    resolvedWorkspaceProfile,
} from '~/core/workspace-profiles/projection';
import { isMobile } from '~/state/global';
import { useViewOnlyAccess } from '~/composables/auth/useViewOnlyAccess';

const iconPlus = useIcon('ui.plus');
const iconNewChat = useIcon('sidebar.new_chat');
const iconNewNote = useIcon('sidebar.new_note');
const iconNewFolder = useIcon('sidebar.new_folder');
const iconPageHome = useIcon('sidebar.page.home');
const iconPageDefault = useIcon('sidebar.page.default');
const iconPageFiles = useIcon('sidebar.page.files');
const iconDashboard = useIcon('dashboard.home');
const or3Config = useOr3Config();
const viewOnly = useViewOnlyAccess();
const documentsEnabled = computed(() => or3Config.features.documents.enabled);
const dashboardEnabled = computed(() => or3Config.features.dashboard.enabled);

const props = defineProps<{
    activeThread?: string;
}>();

const DEFAULT_PAGE_ID = 'sidebar-home';
const DASHBOARD_RAIL_ID = 'dashboard';

type CreateKind = 'chat' | 'document' | 'project';

const createOpen = ref(false);
// Tones match the Chats/Documents/Projects page links in the expanded sidebar.
const createItems = computed(() => [
    {
        kind: 'chat' as const,
        label: 'New chat',
        icon: iconNewChat.value,
        accent: 'chats',
        tone: 'bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)]',
    },
    ...(documentsEnabled.value && !viewOnly.value
        ? [
              {
                  kind: 'document' as const,
                  label: 'New document',
                  icon: iconNewNote.value,
                  accent: 'docs',
                  tone: 'bg-[color:var(--md-success)]/12 text-[color:var(--md-success)]',
              },
          ]
        : []),
    ...(!viewOnly.value ? [{
        kind: 'project' as const,
        label: 'New project',
        icon: iconNewFolder.value,
        accent: 'projects',
        tone: 'bg-[color:var(--md-secondary)]/15 text-[color:var(--md-on-surface-variant)]',
    }] : []),
]);

function onCreate(kind: CreateKind) {
    createOpen.value = false;
    if (kind === 'chat') emit('new-chat');
    else if (kind === 'document') emit('new-document');
    else emit('new-project');
}

// The dashboard opens as a modal over the current page, so it takes the
// selected state while open.
const dashboardOpen = inject<Ref<boolean>>(
    'or3:dashboard-modal-open',
    ref(false)
);

// Theme overrides for collapsed sidebar buttons
const newChatButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.new-chat',
        isNuxtUI: true,
    });

    const themeUi = (overrides.value as any)?.ui || {};

    const mergedUi = { ...themeUi };

    return {
        size: 'sb-square' as const,
        icon: iconPlus.value,
        ...(overrides.value as any),
        ui: mergedUi,
    };
});

const collapsedPageButtonUiDefaults = {
    default: {
        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] hover:ring-1 hover:ring-[var(--md-surface-active)] active:bg-[var(--md-surface-active)] text-[var(--md-on-surface)]',
        leadingIcon: 'w-6 h-6',
    },
    active: {
        base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]  text-[var(--md-on-surface)]',
        leadingIcon: 'w-6 h-6',
    },
} as const;

function createCollapsedPageButtonProps(state?: 'active') {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.collapsed-page',
        state,
        isNuxtUI: true,
    });

    const stateKey = state === 'active' ? 'active' : 'default';

    return computed(() => {
        const overrideValue = (overrides.value as any) || {};
        const { ui: themeUi = {}, ...restOverrides } = overrideValue;
        const mergedUi = {
            ...collapsedPageButtonUiDefaults[stateKey],
            ...(themeUi as Record<string, unknown>),
        };

        return {
            size: 'sb-base' as const,
            color: 'on-surface' as const,
            ...restOverrides,
            ui: mergedUi,
        };
    });
}

const pageButtonProps = createCollapsedPageButtonProps();
const pageButtonActiveProps = createCollapsedPageButtonProps('active');

const { listSidebarPages } = useSidebarPages();
const { activePageId, setActivePage } = useActiveSidebarPage();
const activeRailItem = computed(() =>
    dashboardOpen.value ? DASHBOARD_RAIL_ID : activePageId.value
);

const projectedPages = computed(() => {
    void resolvedWorkspaceProfile.value;
    return projectProfileItems(
        isMobile.value ? 'mobile-bottom-navigation' : 'navigation',
        listSidebarPages.value
    );
});
const showHomePage = computed(() => {
    const pageIds = isMobile.value
        ? resolvedWorkspaceProfile.value.mobile.bottomNavigation
        : resolvedWorkspaceProfile.value.navigation.items;
    return pageIds.includes(DEFAULT_PAGE_ID);
});
const orderedPages = computed(() => {
    if (!projectedPages.value.length) return [];

    // Filter out the default and inline pages as they are rendered in the home scroll
    const hiddenPages = new Set([
        DEFAULT_PAGE_ID,
        'sidebar-chats',
        'sidebar-docs',
        'sidebar-projects-home',
    ]);
    const filtered = projectedPages.value.filter(
        (page) => !hiddenPages.has(page.id)
    );

    // The profile projector has already applied explicit order and append rules.
    return filtered;
});
const orderedPageGroups = computed(() => {
    const pages = new Map(orderedPages.value.map((page) => [page.id, page]));
    const groups = resolvedWorkspaceProfile.value.navigation.groups
        .map((group) => ({
            id: group.id,
            label: group.label,
            pages: group.items.flatMap((id) => {
                const page = pages.get(id);
                return page ? [page] : [];
            }),
        }))
        .filter((group) => group.pages.length > 0);
    const grouped = new Set(
        groups.flatMap((group) => group.pages.map((page) => page.id))
    );
    const remaining = orderedPages.value.filter(
        (page) => !grouped.has(page.id)
    );
    if (remaining.length) {
        groups.push({ id: 'other', label: 'Other', pages: remaining });
    }
    return groups;
});

const activeDocumentIds = computed<string[]>(() => {
    const api = getGlobalMultiPaneApi();
    if (api && api.panes && Array.isArray(api.panes.value)) {
        return api.panes.value
            .filter((p) => p.mode === 'doc' && p.documentId)
            .map((p) => p.documentId as string);
    }
    return [];
});

const activeThreadIds = computed<string[]>(() => {
    const api = getGlobalMultiPaneApi();
    if (api && api.panes && Array.isArray(api.panes.value)) {
        const ids = api.panes.value
            .filter((p) => p.mode === 'chat' && p.threadId)
            .map((p) => p.threadId as string)
            .filter(Boolean);
        if (ids.length) return ids;
    }
    return props.activeThread ? [props.activeThread] : [];
});

const collapsedFooterContext = () => ({
    activeThreadId: activeThreadIds.value[0] ?? null,
    activeDocumentId: activeDocumentIds.value[0] ?? null,
    isCollapsed: true,
});

const sidebarFooterActions = useSidebarFooterActions(collapsedFooterContext);

async function handleSidebarFooterAction(entry: SidebarFooterActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(collapsedFooterContext());
    } catch (error) {
        console.error(
            `[SidebarCollapsed] footer action "${entry.action.id}" failed`,
            error
        );
    }
}

const toast = useToast();
const { openProjectsSidebar } = useProjectSidebar();

async function handlePageSelect(pageId: string) {
    // If selecting home, ensure we navigate to root if not already there
    if (pageId === DEFAULT_PAGE_ID) {
        await navigateTo('/');
    }

    if (pageId === activePageId.value && pageId !== 'sidebar-projects-home') return;

    try {
        const ok = pageId === 'sidebar-projects-home' ? await openProjectsSidebar() : await setActivePage(pageId);
        if (!ok) {
            // Show toast if activation was vetoed
            const page = listSidebarPages.value.find((p) => p.id === pageId);
            toast.add({
                title: 'Cannot switch page',
                description: page?.label
                    ? `Unable to activate "${page.label}"`
                    : 'Page activation failed',
                color: 'neutral',
            });
        } else {
            // Expand sidebar to show the selected page content
            emit('expand-sidebar');
        }
    } catch (error) {
        console.error(
            `[SidebarCollapsed] failed to activate sidebar page "${pageId}"`,
            error
        );
        toast.add({
            title: 'Error',
            description: 'Failed to switch pages',
            color: 'error',
        });
    }
}

const emit = defineEmits<{
    (e: 'new-chat'): void;
    (e: 'new-document'): void;
    (e: 'new-project'): void;
    (e: 'toggle-dashboard'): void;
    (e: 'expand-sidebar'): void;
}>();
</script>

<style scoped>
/* Keep the footer anchored before client-only controls finish mounting. */
.sidebar-bottom-section {
    margin-top: auto;
    flex-shrink: 0;
}
</style>
