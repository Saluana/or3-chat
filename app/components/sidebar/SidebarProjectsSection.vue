<template>
    <div class="mt-4 space-y-2">
        <SidebarGroupHeader
            label="Projects"
            :collapsed="collapsed"
            action-label="+ New project"
            @toggle="emit('toggle-collapse')"
            @action="emit('new-project')"
        />

        <!-- Grid-based height animation for smooth collapse/expand -->
        <div
            class="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
            :class="
                collapsed
                    ? 'grid-rows-[0fr] opacity-0'
                    : 'grid-rows-[1fr] opacity-100'
            "
        >
            <div class="overflow-hidden min-h-0">
                <div v-if="projects.length > 0" class="space-y-0.5">
                    <div
                        v-for="project in projects"
                        :key="project.id"
                        class="project-group-container mb-0.5 rounded-[var(--md-border-radius)] overflow-hidden"
                    >
                        <SidebarProjectRoot
                            :project="project"
                            :expanded="expandedProjectsSet.has(project.id)"
                            @toggle-expand="toggleProjectExpand(project.id)"
                            @add-chat="emit('add-chat-to-project', project.id)"
                            @add-document="
                                emit('add-document-to-project-root', project.id)
                            "
                            @rename="emit('rename-project', project.id)"
                            @delete="emit('delete-project', project.id)"
                        />

                        <!-- Nested grid animation for project children -->
                        <div
                            v-if="project.data.length > 0"
                            class="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
                            :class="
                                expandedProjectsSet.has(project.id)
                                    ? 'grid-rows-[1fr] opacity-100'
                                    : 'grid-rows-[0fr] opacity-0'
                            "
                        >
                            <div class="overflow-hidden min-h-0">
                                <div
                                    class="ml-5 border-l-2 border-[color:var(--md-primary-tint)]/60 space-y-1"
                                >
                                    <SidebarProjectChild
                                        v-for="child in project.data"
                                        :key="`${project.id}:${child.id}`"
                                        :child="child"
                                        :active="isProjectChildActive(child)"
                                        @select="
                                            () => onProjectChildSelect(child)
                                        "
                                        @rename="
                                            emit('rename-entry', {
                                                projectId: project.id,
                                                entryId: child.id,
                                                kind: child.kind,
                                            })
                                        "
                                        @remove="
                                            emit('remove-from-project', {
                                                projectId: project.id,
                                                entryId: child.id,
                                                kind: child.kind,
                                            })
                                        "
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    v-else
                    class="mx-1 rounded-xl border border-dashed border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/35 px-3 py-3.5 project-empty-state"
                >
                    <div class="flex items-start gap-3">
                        <div
                            class="project-empty-icon shrink-0 w-9 h-9 rounded-lg border border-dashed border-[color:var(--md-border-color)] bg-[color:var(--md-surface)] flex items-center justify-center text-[color:var(--md-on-surface-variant)]"
                        >
                            <UIcon :name="iconPlus" class="w-4 h-4" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <div
                                class="project-empty-title text-[13px] font-semibold text-[color:var(--md-on-surface)]"
                            >
                                No projects yet
                            </div>
                            <p
                                class="project-empty-description mt-0.5 text-[11px] leading-snug text-[color:var(--md-on-surface-variant)]"
                            >
                                Create your first project to organize chats and
                                documents.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Project } from '~/db';
import type {
    ProjectEntry,
    ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';
import SidebarProjectRoot from './SidebarProjectRoot.vue';
import SidebarProjectChild from './SidebarProjectChild.vue';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import { useIcon } from '~/composables/useIcon';

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };
type ProjectEntryPayload = {
    projectId: string;
    entryId: string;
    kind: ProjectEntryKind;
};

const props = defineProps<{
    projects: SidebarProject[];
    collapsed: boolean;
    expandedProjects: string[];
    activeThreadIds: string[];
    activeDocumentIds: string[];
}>();

const iconPlus = useIcon('ui.plus');

const emit = defineEmits<{
    (e: 'toggle-collapse'): void;
    (e: 'new-project'): void;
    (e: 'add-chat-to-project', id: string): void;
    (e: 'add-document-to-project-root', id: string): void;
    (e: 'rename-project', id: string): void;
    (e: 'delete-project', id: string): void;
    (e: 'rename-entry', payload: ProjectEntryPayload): void;
    (e: 'remove-from-project', payload: ProjectEntryPayload): void;
    (e: 'select-thread', id: string): void;
    (e: 'select-document', id: string): void;
    (e: 'update:expandedProjects', value: string[]): void;
}>();

const expandedProjectsSet = computed(() => new Set(props.expandedProjects));

function toggleProjectExpand(id: string) {
    const next = new Set(props.expandedProjects);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    emit('update:expandedProjects', Array.from(next));
}

function isProjectChildActive(child: ProjectEntry) {
    if (child.kind === 'chat') {
        return props.activeThreadIds.includes(child.id);
    }
    return props.activeDocumentIds.includes(child.id);
}

function onProjectChildSelect(child: ProjectEntry) {
    if (child.kind === 'chat') {
        emit('select-thread', child.id);
    } else {
        emit('select-document', child.id);
    }
}
</script>
