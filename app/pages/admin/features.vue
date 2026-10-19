<template>
    <AdminConfigEditor
        title="Features"
        description="Choose which tools are available to your users."
        icon="i-heroicons-sparkles"
        :groups="['Features']"
        variant="features"
    />
</template>

<script setup lang="ts">
import AdminConfigEditor from '~/components/admin/system/AdminConfigEditor.vue';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});
</script>
