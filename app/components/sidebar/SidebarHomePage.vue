<template>
    <div class="flex flex-col h-full min-h-0 px-2">
        <!-- Single scroll container for all content -->
        <ClientOnly>
            <Or3Scroll
                ref="scrollAreaRef"
                :items="combinedItems"
                :item-key="(item) => item.key"
                :estimate-height="40"
                :overscan="240"
                :maintain-bottom="false"
                class="flex-1 min-h-0 sidebar-scroll"
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
                        :class="item.class"
                        @select="setActivePage(item.pageId)"
                    />

                    <!-- Projects Section -->
                    <SidebarProjectsSection
                        v-else-if="item.type === 'projects'"
                        :projects="displayProjects"
                        :collapsed="projectsCollapsed"
                        :expanded-projects="expandedProjects"
                        :active-thread-ids="activeThreadIds"
                        :active-document-ids="activeDocumentIds"
                        @toggle-collapse="
                            projectsCollapsed = !projectsCollapsed
                        "
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

                    <!-- Time Group Header -->
                    <SidebarGroupHeader
                        v-else-if="item.type === 'time-group-header'"
                        class="mt-3 time-group-header"
                        :label="item.label"
                        :collapsed="collapsedGroups.has(item.groupKey)"
                        @toggle="toggleGroup(item.groupKey)"
                    />

                    <!-- Unified Item -->
                    <SidebarUnifiedItem
                        v-else-if="item.type === 'time-group-item'"
                        :item="item.item"
                        :active="allActiveIds.includes(item.item.id)"
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
                    />

                    <!-- Empty State -->
                    <SidebarEmptyState
                        v-else-if="item.type === 'empty-state'"
                        icon="lucide:ghost"
                        title="No activity yet"
                        description="Kick things off with a project, or jump straight into a chat or document."
                        actions-layout="column"
                        class="mx-1 sb-empty-state"
                        style="width: calc(100% - 8px)"
                    >
                        <template #actions>
                            <UButton
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[12px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/15"
                                title="Create your first project"
                                @click="emit('new-project')"
                            >
                                Create your first project
                            </UButton>
                            <UButton
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[12px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/15"
                                title="Start a new chat"
                                @click="emit('new-chat')"
                            >
                                Start a new chat
                            </UButton>
                            <UButton
                                size="sm"
                                variant="ghost"
                                class="w-full justify-center whitespace-nowrap truncate text-[12px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/15"
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
import { ref, computed, reactive, watch, onUnmounted } from 'vue';
import type { Component } from 'vue';

// Component name for KeepAlive matching
defineOptions({
    name: 'sidebar-home',
});
import type { Post, Project, Thread } from '~/db';
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
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';
import { useIcon } from '~/composables/useIcon';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import type { SidebarFooterActionEntry } from '~/composables/sidebar/useSidebarSections';

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
          class?: string;
      }
    | { key: string; type: 'projects' }
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

// Paginated items
const sidebarQuery = computed(() => props.sidebarQuery.trim());
const { items, loading, reset } = usePaginatedSidebarItems({
    query: sidebarQuery,
});

const iconChats = useIcon('sidebar.page.messages');
const iconDocs = useIcon('sidebar.note');

watch(sidebarQuery, () => {
    void reset();
});

// All active IDs for highlighting
const allActiveIds = computed(() => [
    ...props.activeThreadIds,
    ...props.activeDocumentIds,
]);

// Group items by time
const groupedItems = computed(() => {
    const groups = new Map<TimeGroup, UnifiedSidebarItem[]>();

    for (const item of items.value) {
        const groupKey = computeTimeGroup(item.updatedAt);
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

// Build combined items list for Or3Scroll
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

    result.push(
        {
            key: 'page-link-chats',
            type: 'page-link',
            label: 'Chats',
            class: 'mb-3',
            description: 'Jump into your conversation history.',
            icon: iconChats.value,
            pageId: 'sidebar-chats',
        },
        {
            key: 'page-link-docs',
            type: 'page-link',
            label: 'Documents',
            description: 'Open and manage your docs.',
            icon: iconDocs.value,
            pageId: 'sidebar-docs',
            class: 'mb-3',
        }
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
                    key: `time-group-item-${item.id}`,
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
