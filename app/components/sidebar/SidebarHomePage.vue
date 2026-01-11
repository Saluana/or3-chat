<template>
    <div class="flex flex-col h-full min-h-0">
        <!-- Single scroll container for all content -->
        <ClientOnly>
            <Or3Scroll
                ref="scrollAreaRef"
                :items="combinedItems"
                :item-key="(item) => item.key"
                :estimate-height="56"
                :overscan="512"
                class="flex-1 min-h-0"
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

                    <!-- Projects Section -->
                    <SidebarProjectsSection
                        v-else-if="item.type === 'projects'"
                        :projects="displayProjects"
                        :collapsed="projectsCollapsed"
                        :expanded-projects="expandedProjects"
                        :active-thread-ids="activeThreadIds"
                        :active-document-ids="activeDocumentIds"
                        @toggle-collapse="projectsCollapsed = !projectsCollapsed"
                        @update:expanded-projects="val => emit('update:expandedProjects', val)"
                        @add-chat-to-project="id => emit('add-chat-to-project', id)"
                        @add-document-to-project="id => emit('add-document-to-project', id)"
                        @rename-project="id => emit('rename-project', id)"
                        @delete-project="id => emit('delete-project', id)"
                        @rename-entry="payload => emit('rename-entry', payload)"
                        @remove-from-project="payload => emit('remove-from-project', payload)"
                        @select-thread="id => emit('select-thread', id)"
                        @select-document="id => emit('select-document', id)"
                    />

                    <!-- Time Group Header -->
                    <SidebarGroupHeader
                        v-else-if="item.type === 'header'"
                        :label="item.label"
                        :collapsed="collapsedGroups.has(item.groupKey)"
                        @toggle="toggleGroup(item.groupKey)"
                    />

                    <!-- Unified Item (thread/document) -->
                    <SidebarUnifiedItem
                        v-else
                        :item="item"
                        :active="isActive(item)"
                        :time-display="formatTime(item.updatedAt, item.groupKey)"
                        @select="() => onItemSelected(item)"
                        @rename="() => onItemRename(item)"
                        @delete="() => onItemDelete(item)"
                        @add-to-project="() => onItemAddToProject(item)"
                    />
                </template>
            </Or3Scroll>
            
            <!-- Loading state (absolute overlay) -->
            <div v-if="loading" class="absolute inset-0 p-4 space-y-4 animate-pulse bg-[var(--md-surface)]">
                <div v-for="i in 3" :key="i" class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-[var(--md-border-radius)] bg-[var(--md-surface-variant)]" />
                    <div class="flex-1 space-y-2">
                        <div class="h-4 w-3/4 rounded bg-[var(--md-surface-variant)]" />
                        <div class="h-3 w-1/4 rounded bg-[var(--md-surface-variant)]" />
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
                        <span v-if="entry.action.label" class="ml-1 text-xs font-medium">
                            {{ entry.action.label }}
                        </span>
                    </UButton>
                </UTooltip>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import type { Component } from 'vue';
import type { Post, Project } from '~/db';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import { Or3Scroll } from 'or3-scroll';
import { usePaginatedSidebarItems } from '~/composables/sidebar/usePaginatedSidebarItems';
import { computeTimeGroup, getTimeGroupLabel, formatTimeDisplay, type TimeGroup } from '~/utils/sidebar/sidebarTimeUtils';
import SidebarProjectsSection from './SidebarProjectsSection.vue';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };

interface SidebarPageProps {
    pageId: string;
    isActive: boolean;
    setActivePage: (id: string) => Promise<void>;
    resetToDefault: () => Promise<void>;
}

const props = defineProps<{
    activeThread?: string;
    items: any[];
    projects: SidebarProject[];
    expandedProjects: string[];
    docs: Post[];
    listHeight: number;
    activeSections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    };
    displayThreads: any[];
    displayProjects: SidebarProject[];
    displayDocuments?: Post[];
    sidebarQuery: string;
    activeDocumentIds: string[];
    activeThreadIds: string[];
    sidebarFooterActions: any[];
    resolvedSidebarSections: {
        top: { id: string; component: Component }[];
        main: { id: string; component: Component }[];
        bottom: { id: string; component: Component }[];
    };
} & SidebarPageProps>();

const emit = defineEmits([
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

const scrollAreaRef = ref<any>(null);
const bottomNavRef = ref<HTMLElement | null>(null);

// Project state
const projectsCollapsed = ref(false);

// Time grouping state
const collapsedGroups = reactive(new Set<string>());

function toggleGroup(groupKey: string) {
    if (collapsedGroups.has(groupKey)) {
        collapsedGroups.delete(groupKey);
    } else {
        collapsedGroups.add(groupKey);
    }
}

// Paginated items
const { items, loading, hasMore, loadMore, reset } = usePaginatedSidebarItems();

// Initial load
import { onMounted } from 'vue';
onMounted(() => {
    loadMore();
});

// All active IDs for highlighting
const allActiveIds = computed(() => [
    ...props.activeThreadIds,
    ...props.activeDocumentIds,
]);

function isActive(item: any) {
    return allActiveIds.value.includes(item.id);
}

function formatTime(updatedAt: number, groupKey: TimeGroup) {
    return formatTimeDisplay(updatedAt, groupKey);
}

// Group items by time
const groupedItems = computed(() => {
    const groups = new Map<TimeGroup, any[]>();
    
    for (const item of items.value) {
        const groupKey = computeTimeGroup(item.updatedAt);
        if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(item);
    }
    
    return groups;
});

// Build combined items list for Or3Scroll
const combinedItems = computed(() => {
    const result: any[] = [];
    
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
    
    // Projects section (single item that renders the whole section)
    if (props.activeSections.projects) {
        result.push({
            key: 'projects-section',
            type: 'projects',
        });
    }
    
    // Time-grouped items
    for (const [groupKey, groupItems] of groupedItems.value) {
        // Add header
        result.push({
            key: `header-${groupKey}`,
            type: 'header',
            label: getTimeGroupLabel(groupKey),
            groupKey,
        });
        
        // Add items if group is not collapsed
        if (!collapsedGroups.has(groupKey)) {
            for (const item of groupItems) {
                result.push({
                    ...item,
                    key: `item-${item.id}`,
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

function onItemSelected(item: any) {
    if (item.type === 'thread') emit('select-thread', item.id);
    else emit('select-document', item.id);
}

function onItemRename(item: any) {
    if (item.type === 'thread') emit('rename-thread', item);
    else emit('rename-document', item);
}

function onItemDelete(item: any) {
    if (item.type === 'thread') emit('delete-thread', item);
    else emit('delete-document', item);
}

function onItemAddToProject(item: any) {
    if (item.type === 'thread') emit('add-thread-to-project', item);
    else emit('add-document-to-project-from-list', item);
}

// Expose methods for parent components if needed
defineExpose({
    scrollAreaRef,
    bottomNavRef,
});
</script>
