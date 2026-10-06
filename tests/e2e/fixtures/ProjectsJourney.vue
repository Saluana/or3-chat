<script setup lang="ts">
import SidebarProjectsPage from '~/components/sidebar/SidebarProjectsPage.vue';
import WorkspaceFilesPane from '~/components/files/WorkspaceFilesPane.vue';
import WorkspaceBackupApp from '~/components/dashboard/workspace/WorkspaceBackupApp.vue';
const view = ref('projects');
</script>
<template>
    <main class="h-dvh">
        <nav aria-label="Journey workspace views">
            <button @click="view = 'projects'">Project workspace</button
            ><button @click="view = 'files'">Workspace Files</button
            ><button @click="view = 'backup'">Backup and restore</button>
        </nav>
        <SidebarProjectsPage v-if="view === 'projects'" /><WorkspaceFilesPane
            v-else-if="view === 'files'"
        /><WorkspaceBackupApp v-else />
    </main>
</template>
