<template>
    <div class="space-y-1">
        <SidebarGroupHeader 
            label="Projects" 
            :collapsed="collapsed" 
            @toggle="emit('toggle-collapse')" 
        />
        
        <Transition name="section-expand">
            <div v-if="!collapsed" class="space-y-0.5">
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
                        @add-document="emit('add-document-to-project', project.id)"
                        @rename="emit('rename-project', project.id)"
                        @delete="emit('delete-project', project.id)"
                    />

                    <Transition name="project-expand">
                        <div
                            v-if="project.data.length > 0 && expandedProjectsSet.has(project.id)"
                            class="pl-4 pb-2 space-y-1"
                        >
                            <SidebarProjectChild
                                v-for="child in project.data"
                                :key="`${project.id}:${child.id}`"
                                :child="child"
                                :parent-id="project.id"
                                :active="isProjectChildActive(child)"
                                @select="() => onProjectChildSelect(child, project.id)"
                                @rename="emit('rename-entry', { projectId: project.id, entryId: child.id, kind: child.kind })"
                                @remove="emit('remove-from-project', { projectId: project.id, entryId: child.id, kind: child.kind })"
                            />
                        </div>
                    </Transition>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import SidebarProjectRoot from './SidebarProjectRoot.vue';
import SidebarProjectChild from './SidebarProjectChild.vue';
import SidebarGroupHeader from './SidebarGroupHeader.vue';

const props = defineProps<{
    projects: any[];
    collapsed: boolean;
    expandedProjects: string[];
    activeThreadIds: string[];
    activeDocumentIds: string[];
}>();

const emit = defineEmits<{
    (e: 'toggle-collapse'): void;
    (e: 'add-chat-to-project', id: string): void;
    (e: 'add-document-to-project', id: string): void;
    (e: 'rename-project', id: string): void;
    (e: 'delete-project', id: string): void;
    (e: 'rename-entry', payload: any): void;
    (e: 'remove-from-project', payload: any): void;
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

function isProjectChildActive(child: any) {
    if (child.kind === 'thread') {
        return props.activeThreadIds.includes(child.id);
    }
    return props.activeDocumentIds.includes(child.id);
}

function onProjectChildSelect(child: any, projectId: string) {
    if (child.kind === 'thread') {
        emit('select-thread', child.id);
    } else {
        emit('select-document', child.id);
    }
}
</script>

<style scoped>
.section-expand-enter-active,
.section-expand-leave-active,
.project-expand-enter-active,
.project-expand-leave-active {
    transition: all 0.2s ease-out;
    max-height: 1000px;
}

.section-expand-enter-from,
.section-expand-leave-to,
.project-expand-enter-from,
.project-expand-leave-to {
    max-height: 0;
    opacity: 0;
    overflow: hidden;
}
</style>
