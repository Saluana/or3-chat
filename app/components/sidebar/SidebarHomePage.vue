<template>
    <div class="sidebar-home-page flex flex-col h-full min-h-0">
        <!-- Single scroll container for all content -->
        <ClientOnly>
            <Or3Scroll
                ref="scrollAreaRef"
                :items="combinedItems"
                :item-key="(item) => item.key"
                :estimate-height="40"
                :overscan="600"
                mutation-mode="arbitrary"
                :maintain-bottom="false"
                class="flex-1 min-h-0 sidebar-scroll"
                @reach-bottom="loadMore"
            >
                <template #default="{ item }">
                    <!-- Custom Top Sections -->
                    <component
                        v-if="item.type === 'custom-top'"
                        :is="item.component"
                    />

                    <!-- Custom Main Sections -->
                    <component
                        v-else-if="item.type === 'custom-main'"
                        :is="item.component"
                    />

                    <!-- Custom Bottom Sections -->
                    <component
                        v-else-if="item.type === 'custom-bottom'"
                        :is="item.component"
                    />

                    <!-- Page links -->
                    <SidebarPageLink
                        v-else-if="item.type === 'page-link'"
                        :label="item.label"
                        :description="item.description"
                        :icon="item.icon"
                        :accent="item.accent"
                        :class="item.class"
                        @select="
                            item.pageId === 'sidebar-projects-home'
                                ? openProjectsSidebar()
                                : setActivePage(item.pageId)
                        "
                    />

                    <!-- Projects Section -->
                    <SidebarProjectsSection
                        v-else-if="item.type === 'projects'"
                        class="pb-4"
                        :projects="homeProjects"
                        :has-more="displayProjects.length > 5"
                        :collapsed="projectsCollapsed"
                        :expanded-projects="expandedProjects"
                        :active-thread-ids="activeThreadIds"
                        :active-document-ids="activeDocumentIds"
                        @toggle-collapse="
                            projectsCollapsed = !projectsCollapsed
                        "
                        @new-project="emit('new-project')"
                        @show-more="openProjectsSidebar()"
                        @update:expanded-projects="
                            (val) => emit('update:expandedProjects', val)
                        "
                        @add-chat-to-project="
                            (id) => emit('add-chat-to-project', id)
                        "
                        @add-document-to-project-root="
                            (id) => emit('add-document-to-project-root', id)
                        "
                        @rename-project="(id) => emit('rename-project', id)"
                        @delete-project="(id) => emit('delete-project', id)"
                        @rename-entry="
                            (payload) => emit('rename-entry', payload)
                        "
                        @remove-from-project="
                            (payload) => emit('remove-from-project', payload)
                        "
                        @select-thread="(id) => emit('select-thread', id)"
                        @select-document="(id) => emit('select-document', id)"
                    />

                    <!-- Pinned chats and documents -->
                    <SidebarGroupHeader
                        v-else-if="item.type === 'pinned-header'"
                        class="mt-1 time-group-header pinned-header"
                        label="Pinned"
                        :collapsed="pinnedCollapsed"
                        @toggle="pinnedCollapsed = !pinnedCollapsed"
                    />
                    <SidebarFamilyItem
                        v-else-if="item.type === 'pinned-item'"
                        class="mb-0.5"
                        :item="item.item"
                        :active="allActiveIds.includes(item.item.id)"
                        time-display=""
                        @select="() => onItemSelected(item.item)"
                        @rename="() => onItemRename(item.item)"
                        @delete="() => onItemDelete(item.item)"
                        @add-to-project="() => onItemAddToProject(item.item)"
                    />

                    <!-- Time Group Header -->
                    <SidebarGroupHeader
                        v-else-if="item.type === 'time-group-header'"
                        class="mt-1 time-group-header"
                        :label="item.label"
                        :collapsed="collapsedGroups.has(item.groupKey)"
                        @toggle="toggleGroup(item.groupKey)"
                    />

                    <!-- Unified Item -->
                    <SidebarFamilyItem
                        v-else-if="item.type === 'time-group-item'"
                        :item="item.item"
                        :active="item.item.family?.kind === 'group-header'
                            ? activeFamilyIds.has(item.item.family.rootId)
                            : allActiveIds.includes(item.item.id)"
                        :time-display="
                            formatTimeDisplay(
                                item.item.updatedAt,
                                item.groupKey
                            )
                        "
                        :class="[
                            'mb-0.5',
                            collapsingGroups.has(item.groupKey) && 'is-exiting',
                        ]"
                        @select="() => onItemSelected(item.item)"
                        @rename="() => onItemRename(item.item)"
                        @delete="() => onItemDelete(item.item)"
                        @add-to-project="() => onItemAddToProject(item.item)"
                        @toggle-family="toggleFamily"
                        @load-more-members="loadMoreMembers"
                        @latest-compaction="goToLatestCompaction"
                        @navigate="emit('select-thread', $event)"
                    />

                    <!-- First run: no chats, documents, or projects yet -->
                    <div
                        v-else-if="item.type === 'empty-state' && showWelcome"
                        class="sb-welcome pt-3 pb-4"
                    >
                        <div
                            class="sb-welcome-card relative px-4 pt-6 pb-4 text-center"
                        >
                            <div
                                class="relative mx-auto size-[84px]"
                                aria-hidden="true"
                            >
                                <span
                                    class="sb-welcome-halo absolute inset-0 rounded-full"
                                />
                                <span
                                    class="sb-welcome-icon absolute inset-[8px] rounded-full flex items-center justify-center"
                                >
                                    <UIcon
                                        name="lucide:ghost"
                                        class="sb-welcome-ghost size-8"
                                    />
                                </span>
                                <svg
                                    v-for="spark in welcomeSparkles"
                                    :key="spark.key"
                                    class="sb-welcome-spark absolute"
                                    :style="spark.style"
                                    viewBox="0 0 16 16"
                                >
                                    <path
                                        d="M8 0C8.6 4.6 11.4 7.4 16 8C11.4 8.6 8.6 11.4 8 16C7.4 11.4 4.6 8.6 0 8C4.6 7.4 7.4 4.6 8 0Z"
                                        fill="currentColor"
                                    />
                                </svg>
                            </div>
                            <h3
                                class="mt-4 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[var(--md-on-surface)]"
                            >
                                Nothing here yet
                            </h3>
                            <p
                                class="mt-2 text-[13px] leading-[1.5] text-balance text-[var(--md-on-surface-variant)]"
                            >
                                {{ welcomeDescription }}
                            </p>
                            <div class="mt-5 flex flex-col gap-2">
                                <UButton
                                    color="neutral"
                                    variant="ghost"
                                    :icon="iconNewProject"
                                    :trailing-icon="iconChevronRight"
                                    class="sb-welcome-primary theme-btn group w-full h-11 justify-start! gap-2.5 px-3.5 rounded-[var(--md-border-radius,12px)] border-0 whitespace-nowrap text-[14px] font-semibold bg-[var(--sb-welcome-primary-bg)]! text-[var(--sb-welcome-primary-fg)]! hover:bg-[var(--sb-welcome-primary-hover)]!"
                                    :ui="welcomeButtonUi"
                                    @click="emit('new-project')"
                                >
                                    Create a project
                                </UButton>
                                <UButton
                                    color="neutral"
                                    variant="ghost"
                                    :icon="iconNewChat"
                                    class="sb-welcome-secondary theme-btn w-full h-11 justify-start! gap-2.5 px-3.5 rounded-[var(--md-border-radius,12px)] border-0 whitespace-nowrap text-[14px] font-medium bg-[color-mix(in_srgb,var(--sb-welcome-accent)_6%,var(--md-surface))]! text-[var(--md-on-surface)]! hover:bg-[color-mix(in_srgb,var(--sb-welcome-accent)_11%,var(--md-surface))]!"
                                    :ui="{ ...welcomeButtonUi, leadingIcon: `${welcomeButtonUi.leadingIcon} text-[var(--sb-welcome-accent)]` }"
                                    @click="emit('new-chat')"
                                >
                                    Start a chat
                                </UButton>
                                <UButton
                                    v-if="documentsEnabled"
                                    color="neutral"
                                    variant="ghost"
                                    :icon="iconNewDocument"
                                    class="sb-welcome-secondary theme-btn w-full h-11 justify-start! gap-2.5 px-3.5 rounded-[var(--md-border-radius,12px)] border-0 whitespace-nowrap text-[14px] font-medium bg-[color-mix(in_srgb,var(--sb-welcome-accent)_6%,var(--md-surface))]! text-[var(--md-on-surface)]! hover:bg-[color-mix(in_srgb,var(--sb-welcome-accent)_11%,var(--md-surface))]!"
                                    :ui="{ ...welcomeButtonUi, leadingIcon: `${welcomeButtonUi.leadingIcon} text-[var(--md-success)]` }"
                                    @click="emit('new-document')"
                                >
                                    Create a document
                                </UButton>
                            </div>
                        </div>
                    </div>

                    <!-- Empty State -->
                    <SidebarEmptyState
                        v-else-if="item.type === 'empty-state'"
                        icon="lucide:ghost"
                        :title="sidebarQuery.trim() ? 'No matches found' : 'No activity yet'"
                        :description="sidebarQuery.trim() ? 'This list matches titles only. Search inside messages, try different terms, or clear the search to see your saved work.' : 'Kick things off with a project, or jump straight into a chat or document.'"
                        actions-layout="column"
                        class="sb-empty-state"
                    >
                        <template v-if="sidebarQuery.trim()" #actions>
                            <UButton
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[14px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-on-surface)]/80 hover:bg-[color:var(--md-primary)]/15 backdrop-blur theme-btn"
                                title="Search inside messages"
                                @click="searchInsideMessages"
                            >
                                Search inside messages
                            </UButton>
                        </template>
                        <template v-else #actions>
                            <UButton
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[14px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-on-surface)]/80 hover:bg-[color:var(--md-primary)]/15 backdrop-blur theme-btn"
                                title="Create a project"
                                @click="emit('new-project')"
                            >
                                Create a project
                            </UButton>
                            <UButton
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[14px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-on-surface)]/80 hover:bg-[color:var(--md-primary)]/15 backdrop-blur theme-btn"
                                title="Start a new chat"
                                @click="emit('new-chat')"
                            >
                                Start a new chat
                            </UButton>
                            <UButton
                                v-if="documentsEnabled"
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[14px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-on-surface)]/80 hover:bg-[color:var(--md-primary)]/15 backdrop-blur theme-btn"
                                title="Create a document"
                                @click="emit('new-document')"
                            >
                                Create a document
                            </UButton>
                        </template>
                    </SidebarEmptyState>
                </template>
            </Or3Scroll>

            <!-- Loading state (absolute overlay) -->
            <div
                v-if="loading"
                class="absolute inset-0 p-4 space-y-4 animate-pulse bg-[var(--md-surface)]"
            >
                <div v-for="i in 3" :key="i" class="flex items-center gap-3">
                    <div
                        class="w-8 h-8 rounded-[var(--md-border-radius)] bg-[var(--md-surface-variant)]"
                    />
                    <div class="flex-1 space-y-2">
                        <div
                            class="h-4 w-3/4 rounded bg-[var(--md-surface-variant)]"
                        />
                        <div
                            class="h-3 w-1/4 rounded bg-[var(--md-surface-variant)]"
                        />
                    </div>
                </div>
            </div>
            <template #fallback>
                <div class="flex-1 min-h-0 p-3 space-y-3" aria-hidden="true">
                    <div class="h-9 w-full bg-[var(--md-surface-variant)] animate-pulse" />
                    <div class="h-9 w-4/5 bg-[var(--md-surface-variant)] animate-pulse" />
                    <div class="h-9 w-full bg-[var(--md-surface-variant)] animate-pulse" />
                </div>
            </template>
        </ClientOnly>

        <!-- Footer Actions -->
        <div
            v-if="sidebarFooterActions.length > 0"
            ref="bottomNavRef"
            class="shrink-0 flex flex-col gap-2 p-2"
        >
            <div class="flex flex-wrap gap-2">
                <UTooltip
                    v-for="entry in sidebarFooterActions"
                    :key="`sidebar-footer-${entry.action.id}`"
                    :delay-duration="0"
                    :text="entry.action.tooltip || entry.action.label"
                >
                    <UButton
                        size="xs"
                        variant="ghost"
                        :color="(entry.action.color || 'neutral') as any"
                        :square="!entry.action.label"
                        :disabled="entry.disabled"
                        class="pointer-events-auto"
                        @click="emit('sidebar-footer-action', entry)"
                    >
                        <UIcon :name="entry.action.icon" class="w-4 h-4" />
                        <span
                            v-if="entry.action.label"
                            class="ml-1 text-xs font-medium"
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
import { ref, computed, reactive, onUnmounted } from 'vue';
import type { Component } from 'vue';

// Component name for KeepAlive matching
defineOptions({
    name: 'sidebar-home',
});
import type { Project } from '~/db';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import { Or3Scroll, type Or3ScrollRef } from 'or3-scroll';
import { usePaginatedSidebarItems } from '~/composables/sidebar/usePaginatedSidebarItems';
import {
    computeTimeGroup,
    getTimeGroupLabel,
    formatTimeDisplay,
} from '~/utils/sidebar/sidebarTimeUtils';
import type { TimeGroup } from '~/utils/sidebar/sidebarTimeUtils';
import SidebarProjectsSection from './SidebarProjectsSection.vue';
import SidebarPageLink from './SidebarPageLink.vue';
import SidebarEmptyState from './SidebarEmptyState.vue';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import SidebarFamilyItem from './SidebarFamilyItem.vue';
import { useIcon } from '~/composables/useIcon';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { usePinnedItems } from '~/composables/sidebar/usePinnedItems';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import type { SidebarFooterActionEntry } from '~/composables/sidebar/useSidebarSections';
import { useOr3Config } from '~/composables/useOr3Config';
import { resolvedWorkspaceProfile } from '~/core/workspace-profiles/projection';
import { isMobile } from '~/state/global';
import { useCommandPalette } from '~/composables/search/useCommandPalette';

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };
type SidebarCombinedItem =
    | {
          key: string;
          type: 'custom-top' | 'custom-main' | 'custom-bottom';
          component: Component;
      }
    | {
          key: string;
          type: 'page-link';
          label: string;
          description: string;
          icon: string;
          pageId: string;
          accent?: 'chats' | 'docs' | 'projects';
          class?: string;
      }
    | { key: string; type: 'projects' }
    | { key: string; type: 'pinned-header' }
    | { key: string; type: 'pinned-item'; item: UnifiedSidebarItem }
    | { key: string; type: 'empty-state' }
    | {
          key: string;
          type: 'time-group-header';
          label: string;
          groupKey: TimeGroup;
      }
    | {
          key: string;
          type: 'time-group-item';
          item: UnifiedSidebarItem;
          groupKey: TimeGroup;
      };

interface SidebarPageProps {
    pageId: string;
    isActive: boolean;
    setActivePage: (id: string) => Promise<void>;
    resetToDefault: () => Promise<void>;
}

const props = defineProps<
    {
        expandedProjects: string[];
        activeSections: {
            projects: boolean;
            chats: boolean;
            docs: boolean;
        };
        displayProjects: SidebarProject[];
        sidebarQuery: string;
        activeDocumentIds: string[];
        activeThreadIds: string[];
        sidebarFooterActions: SidebarFooterActionEntry[];
        resolvedSidebarSections: {
            top: { id: string; component: Component }[];
            main: { id: string; component: Component }[];
            bottom: { id: string; component: Component }[];
        };
    } & SidebarPageProps
>();

const emit = defineEmits([
    'new-chat',
    'new-document',
    'new-project',
    'add-chat-to-project',
    'add-document-to-project',
    'add-document-to-project-root',
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
    'sidebar-footer-action',
    'update:expandedProjects',
]);

const scrollAreaRef = ref<Or3ScrollRef | null>(null);
const bottomNavRef = ref<HTMLElement | null>(null);

// Project state
const projectsCollapsed = ref(false);
const homeProjects = computed(() => props.displayProjects.slice(0, 5));

// Time grouping state
const collapsedGroups = reactive(new Set<string>());
const collapsingGroups = reactive(new Set<string>()); // Groups that are animating out
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

const COLLAPSE_ANIMATION_DURATION = 200; // ms

function toggleGroup(groupKey: string) {
    if (collapsedGroups.has(groupKey)) {
        // Expanding: just remove from collapsed
        collapsedGroups.delete(groupKey);
    } else {
        // Collapsing: add to collapsing first (triggers exit animation)
        collapsingGroups.add(groupKey);
        // After animation, actually collapse
        const timeoutId = setTimeout(() => {
            collapsingGroups.delete(groupKey);
            collapsedGroups.add(groupKey);
            pendingTimeouts.delete(timeoutId);
        }, COLLAPSE_ANIMATION_DURATION);
        pendingTimeouts.add(timeoutId);
    }
}

// Config and feature flags (must be declared before usePaginatedSidebarItems)
const or3Config = useOr3Config();
const documentsEnabled = computed(() => or3Config.features.documents.enabled);

// Paginated items
const sidebarQuery = computed(() => props.sidebarQuery.trim());
const commandPalette = useCommandPalette();
/** The sidebar filters titles; the command palette also searches message text. */
function searchInsideMessages(): void {
    commandPalette.query.value = sidebarQuery.value;
    commandPalette.open();
}
const { items, activeFamilyIds, loading, loadMore, toggleFamily, loadMoreMembers, latestCompaction } = usePaginatedSidebarItems({
    query: sidebarQuery,
    type: documentsEnabled.value ? 'all' : 'thread',
    activeIds: computed(() => props.activeThreadIds),
});
const familyToast = useToast();
async function goToLatestCompaction(rootId: string) {
    const id = await latestCompaction(rootId);
    if (id) emit('select-thread', id);
    else familyToast.add({ title: 'No available compaction', description: 'This family has no available compacted conversation in this view.', color: 'neutral' });
}

const iconChats = useIcon('sidebar.category.chats');
const iconDocs = useIcon('sidebar.category.documents');
const iconProjects = useIcon('sidebar.category.projects');
const iconNewProject = useIcon('sidebar.new_folder');
const iconNewChat = useIcon('sidebar.new_chat');
const iconNewDocument = useIcon('sidebar.new_note');
const iconChevronRight = useIcon('ui.chevron.right');
const { openProjectsSidebar } = useProjectSidebar();
const { listSidebarPages } = useSidebarPages();

// All active IDs for highlighting
const allActiveIds = computed(() => [
    ...props.activeThreadIds,
    ...props.activeDocumentIds,
]);

// Group items by time
const groupedItems = computed(() => {
    const groups = new Map<TimeGroup, UnifiedSidebarItem[]>();

    for (const item of items.value) {
        const groupKey = computeTimeGroup(item.family?.groupUpdatedAt ?? item.updatedAt);
        if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(item);
    }

    return groups;
});

const showEmptyState = computed(
    () => !loading.value && items.value.length === 0
);
const isCompletelyEmpty = computed(
    () => showEmptyState.value && props.displayProjects.length === 0
);
// A first-time user (nothing saved, not searching) gets the welcome card.
const showWelcome = computed(
    () => isCompletelyEmpty.value && !sidebarQuery.value
);
const welcomeDescription = computed(() =>
    documentsEnabled.value
        ? 'Get started by creating a project, starting a chat, or creating a document.'
        : 'Get started by creating a project or starting a chat.'
);
const welcomeButtonUi = {
    label: 'truncate',
    leadingIcon: 'size-[18px] shrink-0',
    trailingIcon:
        'size-4 ms-auto shrink-0 transition-transform duration-150 group-hover:translate-x-0.5',
};
// Decorative sparkles around the welcome illustration.
const welcomeSparkles = [
    { key: 'a', style: { top: '2px', right: '0', width: '12px', height: '12px', animationDelay: '0s' } },
    { key: 'b', style: { top: '40px', left: '-6px', width: '8px', height: '8px', animationDelay: '1.2s' } },
    { key: 'c', style: { bottom: '6px', right: '-6px', width: '7px', height: '7px', animationDelay: '2.1s' } },
];

// Build combined items list for Or3Scroll
const { items: pinnedItems } = usePinnedItems();
const pinnedCollapsed = ref(false);

const combinedItems = computed(() => {
    const result: SidebarCombinedItem[] = [];

    // Custom top sections
    for (const section of props.resolvedSidebarSections.top) {
        result.push({
            key: `custom-top-${section.id}`,
            type: 'custom-top',
            component: section.component,
        });
    }

    // Custom main sections
    for (const section of props.resolvedSidebarSections.main) {
        result.push({
            key: `custom-main-${section.id}`,
            type: 'custom-main',
            component: section.component,
        });
    }

    const pageLinks: SidebarCombinedItem[] = [
        {
            key: 'page-link-chats',
            type: 'page-link',
            label: 'Chats',
            class: 'mb-1.5',
            description: '',
            icon: iconChats.value,
            pageId: 'sidebar-chats',
            accent: 'chats',
        },
        ...(documentsEnabled.value
            ? [
                  {
                      key: 'page-link-docs',
                      type: 'page-link' as const,
                      label: 'Documents',
                      description: '',
                      icon: iconDocs.value,
                      pageId: 'sidebar-docs',
                      class: 'mb-1.5',
                      accent: 'docs' as const,
                  },
              ]
            : []),
        {
            key: 'page-link-projects',
            type: 'page-link',
            label: 'Projects',
            description: '',
            icon: iconProjects.value,
            pageId: 'sidebar-projects-home',
            class: 'mb-1.5',
            accent: 'projects',
        },
    ];
    const navigationOrder = isMobile.value
        ? resolvedWorkspaceProfile.value.mobile.bottomNavigation
        : resolvedWorkspaceProfile.value.navigation.items;
    const pageOrder = [
        ...navigationOrder.filter((id) => id !== 'sidebar-projects-home'),
        'sidebar-projects-home',
    ];
    pageLinks.sort(
        (left, right) =>
            pageOrder.indexOf(left.type === 'page-link' ? left.pageId : '') -
            pageOrder.indexOf(right.type === 'page-link' ? right.pageId : ''),
    );
    result.push(
        ...pageLinks.filter(
            (item) =>
                item.type === 'page-link' &&
                (item.pageId === 'sidebar-projects-home'
                    ? listSidebarPages.value.some(
                          (page) => page.id === item.pageId,
                      ) &&
                      !resolvedWorkspaceProfile.value.navigation.hidden.includes(
                          item.pageId,
                      )
                    : navigationOrder.includes(item.pageId)),
        ),
    );

    // Projects section (single item that renders the whole section)
    if (props.activeSections.projects && !isCompletelyEmpty.value) {
        result.push({
            key: 'projects-section',
            type: 'projects',
        });
    }

    if (showEmptyState.value) {
        result.push({
            key: 'home-empty-state',
            type: 'empty-state',
        });
    }

    // Pinned chats and documents sit under projects
    if (pinnedItems.value.length > 0) {
        result.push({ key: 'pinned-header', type: 'pinned-header' });
        if (!pinnedCollapsed.value) {
            for (const item of pinnedItems.value) {
                result.push({ key: `pinned-${item.type}-${item.id}`, type: 'pinned-item', item });
            }
        }
    }

    // Time-grouped items (flattened for true per-item virtualization)
    for (const [groupKey, groupItems] of groupedItems.value) {
        result.push({
            key: `time-group-header-${groupKey}`,
            type: 'time-group-header',
            label: getTimeGroupLabel(groupKey),
            groupKey,
        });

        if (!collapsedGroups.has(groupKey)) {
            for (const item of groupItems) {
                result.push({
                    key: item.family?.key ?? `time-group-item-${item.id}`,
                    type: 'time-group-item',
                    item,
                    groupKey,
                });
            }
        }
    }

    // Custom bottom sections
    for (const section of props.resolvedSidebarSections.bottom) {
        result.push({
            key: `custom-bottom-${section.id}`,
            type: 'custom-bottom',
            component: section.component,
        });
    }

    return result;
});

function onItemSelected(item: UnifiedSidebarItem) {
    if (item.type === 'thread') emit('select-thread', item.id);
    else emit('select-document', item.id);
}

function onItemRename(item: UnifiedSidebarItem) {
    if (item.type === 'thread') emit('rename-thread', item);
    else emit('rename-document', item);
}

function onItemDelete(item: UnifiedSidebarItem) {
    if (item.type === 'thread') emit('delete-thread', item);
    else emit('delete-document', item);
}

function onItemAddToProject(item: UnifiedSidebarItem) {
    if (item.type === 'thread') emit('add-thread-to-project', item);
    else emit('add-document-to-project-from-list', item);
}

// Expose methods for parent components if needed
defineExpose({
    scrollAreaRef,
    bottomNavRef,
});

onUnmounted(() => {
    pendingTimeouts.forEach(clearTimeout);
    pendingTimeouts.clear();
});
</script>

<style scoped>
/* Reserve the existing horizontal inset before client-only list content mounts. */
.sidebar-home-page {
    padding-inline: 0.5rem;
}

/* First-run welcome card. Themes recolor it through these variables. */
.sb-welcome {
    --sb-welcome-accent: var(--md-primary);
    --sb-welcome-on-accent: var(--md-on-primary);
    --sb-welcome-primary-bg: var(--sb-welcome-accent);
    --sb-welcome-primary-fg: var(--sb-welcome-on-accent);
    --sb-welcome-primary-hover: color-mix(in srgb, var(--sb-welcome-accent) 88%, black);
}

.sb-welcome-halo {
    background: radial-gradient(
        circle,
        color-mix(in srgb, var(--sb-welcome-accent) 16%, transparent) 0%,
        transparent 70%
    );
}

.sb-welcome-icon {
    background: var(--md-surface-hover, var(--md-surface-variant));
    color: var(--md-on-surface);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--sb-welcome-accent) 5%, transparent);
}

.sb-welcome-ghost {
    animation: sb-welcome-float 4s ease-in-out infinite;
}

.sb-welcome-spark {
    color: var(--sb-welcome-accent);
    animation: sb-welcome-twinkle 3.2s ease-in-out infinite;
}

@keyframes sb-welcome-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
}

@keyframes sb-welcome-twinkle {
    0%, 100% { opacity: 0.25; transform: scale(0.8); }
    50% { opacity: 0.7; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
    .sb-welcome-ghost,
    .sb-welcome-spark {
        animation: none;
    }

    .sb-welcome-spark {
        opacity: 0.5;
    }
}
</style>
