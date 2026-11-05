<template>
    <div class="space-y-6">
        <h1 class="text-2xl font-semibold">Workspace settings</h1>
        <ChatLimitsSettings />
        <WorkspaceModelsSettings />
        <FileCacheSettings />
    </div>
</template>

<script setup lang="ts">
import FileCacheSettings from '~/components/admin/FileCacheSettings.vue';
import WorkspaceModelsSettings from '~/components/admin/WorkspaceModelsSettings.vue';
import ChatLimitsSettings from '~/components/admin/ChatLimitsSettings.vue';
definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

</script>
