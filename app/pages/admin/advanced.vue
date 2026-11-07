<template>
    <div class="space-y-6">
        <section aria-label="Deployment profile" class="flex flex-wrap items-center gap-2 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3 text-sm">
            <span class="font-semibold">Deployment profile</span>
            <UBadge v-for="fact in profile" :key="fact" color="neutral" variant="soft">{{ fact }}</UBadge>
            <span class="w-full text-xs opacity-70">Build and provider facts, not runtime toggles. Changing a sync, storage or auth provider requires a planned data migration.</span>
        </section>
        <AdminConfigEditor
            title="Advanced Settings"
            description="Infrastructure, security, providers, and deployment-level configuration."
            icon="i-heroicons-adjustments-horizontal"
            :groups="advancedGroups"
            variant="advanced"
        />
        <ResourcePolicy />
        <ServicePauses />
    </div>
</template>

<script setup lang="ts">
import type { ConfigGroup } from '~/composables/admin/useAdminTypes';
import AdminConfigEditor from '~/components/admin/system/AdminConfigEditor.vue';
import ResourcePolicy from '~/components/admin/ResourcePolicy.vue';
import ServicePauses from '~/components/admin/ServicePauses.vue';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const publicConfig = useRuntimeConfig().public as Record<string, unknown> & { sync?: { provider?: string; enabled?: boolean }; storage?: { provider?: string }; openRouter?: { requireUserKey?: boolean } };
const profile = computed(() => [
    `Sync: ${publicConfig.sync?.enabled === false ? 'off' : publicConfig.sync?.provider ?? 'unknown'}`,
    `Storage: ${publicConfig.storage?.provider ?? 'unknown'}`,
    publicConfig.hostedBillingEnabled === true ? 'Hosted billing installed' : 'No hosted billing',
    publicConfig.openRouter?.requireUserKey === true ? 'Personal AI keys required' : 'Instance AI key allowed',
]);

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
