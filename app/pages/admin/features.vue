<template>
    <AdminConfigEditor
        title="Features"
        description="Choose the product capabilities available across your OR3 instance."
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
