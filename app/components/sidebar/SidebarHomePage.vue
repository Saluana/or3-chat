<template>
    <div class="flex flex-col h-full">
        <!-- Scrollable content area -->
        <div
            ref="scrollAreaRef"
            class="flex-1 min-h-0 h-full px-2 flex flex-col gap-3 overflow-hidden"
        >
            <component
                v-for="section in resolvedSidebarSections.top"
                :key="`sidebar-section-top-${section.id}`"
                :is="section.component"
            />
            <component
                v-for="section in resolvedSidebarSections.main"
                :key="`sidebar-section-main-${section.id}`"
                :is="section.component"
            />
            <SidebarVirtualList
                class="flex-1"
                :height="listHeight"
                :projects="displayProjects"
                :threads="displayThreads"
                :documents="docs"
                :display-documents="displayDocuments"
                :expanded-projects="expandedProjects"
                :active-sections="{
                    projects: activeSections.projects,
                    threads: activeSections.chats,
                    docs: activeSections.docs,
                }"
                :active-thread="props.activeThread"
                :active-document="activeDocumentIds[0]"
                :active-threads="activeThreadIds"
                :active-documents="activeDocumentIds"
                @addChat="emit('add-chat-to-project', $event)"
                @addDocument="emit('add-document-to-project', $event)"
                @renameProject="emit('rename-project', $event)"
                @deleteProject="emit('delete-project', $event)"
                @renameEntry="emit('rename-entry', $event)"
                @removeFromProject="emit('remove-from-project', $event)"
                @chatSelected="emit('chat-selected-from-project', $event)"
                @documentSelected="
                    emit('document-selected-from-project', $event)
                "
                @selectThread="emit('select-thread', $event)"
                @renameThread="emit('rename-thread', $event)"
                @deleteThread="emit('delete-thread', $event)"
                @addThreadToProject="emit('add-thread-to-project', $event)"
                @selectDocument="emit('select-document', $event)"
                @renameDocument="emit('rename-document', $event)"
                @deleteDocument="emit('delete-document', $event)"
                @addDocumentToProject="
                    emit('add-document-to-project-from-list', $event)
                "
            />
            <component
                v-for="section in resolvedSidebarSections.bottom"
                :key="`sidebar-section-bottom-${section.id}`"
                :is="section.component"
            />
        </div>
        <div ref="bottomNavRef" class="shrink-0 flex flex-col gap-2">
            <div
                v-if="sidebarFooterActions.length"
                class="flex flex-wrap gap-2"
            >
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
import { ref } from 'vue';
import type { Component } from 'vue';
import SidebarVirtualList from '~/components/sidebar/SidebarVirtualList.vue';
import type { Post, Project } from '~/db';
import type {
    ProjectEntry,
    ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';

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
]);

const scrollAreaRef = ref<HTMLElement | null>(null);
const bottomNavRef = ref<HTMLElement | null>(null);

// Expose methods for parent components if needed
defineExpose({
    scrollAreaRef,
    bottomNavRef,
});
</script>
