<script setup lang="ts">
import SideBar from '~/components/sidebar/SideBar.vue';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import WorkspaceFilesPane from '~/components/files/WorkspaceFilesPane.vue';
import WorkspaceBackupApp from '~/components/dashboard/workspace/WorkspaceBackupApp.vue';
const view = ref('projects');
useResponsiveState();
const { openProjectsSidebar } = useProjectSidebar();
onMounted(() => openProjectsSidebar());
</script>
<template>
    <main class="h-dvh flex flex-col">
        <nav aria-label="Journey workspace views">
            <button @click="view = 'projects'">Project workspace</button
            ><button @click="view = 'files'">Workspace Files</button
            ><button @click="view = 'backup'">Backup and restore</button>
        </nav>
        <aside
            v-if="view === 'projects'"
            aria-label="Navigation"
            class="flex-1 min-h-0"
        >
            <SideBar />
        </aside>
        <WorkspaceFilesPane v-else-if="view === 'files'" /><WorkspaceBackupApp
            v-else
        />
    </main>
</template>
