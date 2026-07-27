<template>
    <AdminConfigEditor
        title="UI & Branding"
        description="Shape how OR3 looks and feels to your users."
        icon="i-heroicons-paint-brush"
        :groups="['UI & Branding']"
    />
</template>

<script setup lang="ts">
import AdminConfigEditor from '~/components/admin/system/AdminConfigEditor.vue';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});
</script>
