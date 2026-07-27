<template>
    <AdminConfigEditor
        title="Advanced Settings"
        description="Infrastructure, security, providers, and deployment-level configuration."
        icon="i-heroicons-adjustments-horizontal"
        :groups="advancedGroups"
        variant="advanced"
    />
</template>

<script setup lang="ts">
import type { ConfigGroup } from '~/composables/admin/useAdminTypes';
import AdminConfigEditor from '~/components/admin/system/AdminConfigEditor.vue';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const advancedGroups: ConfigGroup[] = [
    'Auth',
    'Sync',
    'Storage',
    'Limits & Security',
    'Background Processing',
    'Admin',
    'External Services',
];
</script>
