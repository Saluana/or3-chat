<template>
    <div class="space-y-6">
        <h1 class="text-2xl font-semibold">Workspace file settings</h1>
        <FileCacheSettings />
    </div>
</template>

<script setup lang="ts">
import FileCacheSettings from '~/components/admin/FileCacheSettings.vue';
definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

</script>
