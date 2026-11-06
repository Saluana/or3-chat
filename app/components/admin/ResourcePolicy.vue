<template>
    <section id="resource-policy" class="space-y-3 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-4" aria-labelledby="resource-policy-heading">
        <h2 id="resource-policy-heading" class="text-lg font-semibold">Resource &amp; feature policy</h2>
        <p class="text-sm opacity-70">Existing settings and their owners. Deployment settings without a qualified controller stay read-only; edit the managed deployment configuration and use its supported apply workflow.</p>
        <div class="grid gap-3 md:grid-cols-2">
            <div v-for="group in groups" :key="group.title" class="space-y-2 border-t border-[var(--md-outline-variant)] pt-3">
                <h3 class="font-medium">{{ group.title }}</h3><p class="text-sm opacity-70">{{ group.description }}</p>
                <ul class="space-y-1 text-xs"><li v-for="entry in entries.filter(entry => group.keys.includes(entry.key))" :key="entry.key"><strong>{{ entry.label }}</strong>: {{ entry.masked ? 'Hidden (secret)' : entry.value ?? 'Resolved deployment default' }} · {{ entry.source }} · {{ entry.application }}<br><code>{{ entry.key }}</code></li></ul>
                <UButton v-if="group.to" :to="group.to" size="sm" color="neutral" variant="link">{{ group.action }}</UButton>
            </div>
        </div>
        <p v-if="error" role="alert" class="text-sm text-[var(--md-error)]">{{ error }}</p>
    </section>
</template>
<script setup lang="ts">
const entries = ref<Array<{ key: string; label: string; value: string | null; masked: boolean; source: string; application: string }>>([]);
const error = ref('');
const groups = [
    { title: 'AI funding', description: 'Allowing personal key overrides permits customer credentials. Requiring personal keys refuses instance-funded AI; hosted policy enforces both.', keys: ['OR3_OPENROUTER_REQUIRE_USER_KEY', 'OR3_OPENROUTER_ALLOW_USER_OVERRIDE', 'OPENROUTER_API_KEY'], to: undefined, action: '' },
    { title: 'Background work', description: 'Concurrency and timeout are consumed by server admission and recovery. Deployment changes apply at the supported restart boundary. Existing admitted work keeps its completion rules.', keys: ['OR3_BACKGROUND_STREAMING_ENABLED', 'OR3_BACKGROUND_MAX_JOBS', 'OR3_BACKGROUND_MAX_JOBS_PER_USER', 'OR3_BACKGROUND_JOB_TIMEOUT'], to: '/admin/advanced#pauses', action: 'New-work pauses' },
    { title: 'Request rate groups', description: 'Server endpoint groups cover AI, sync, upload and webhook admission. Overrides use the existing validated deployment JSON; there is no dashboard raw JSON writer.', keys: ['OR3_LIMITS_ENABLED', 'OR3_LIMITS_STORAGE_PROVIDER', 'OR3_RATE_LIMIT_OVERRIDES_JSON', 'OR3_REQUESTS_PER_MINUTE'], to: undefined, action: '' },
    { title: 'Models & workspace limits', description: 'Workspace model allowlists and file policy use the existing owning forms. Deployment policy still bounds workspace behavior.', keys: [], to: '/admin/workspaces', action: 'Choose a workspace' },
    { title: 'Features & plugins', description: 'Site feature settings apply after refresh. Plugin settings and permissions use their existing administration and audit paths.', keys: [], to: '/admin/features', action: 'Feature controls' },
    { title: 'Registration', description: 'The saved registration mode applies through the managed restart workflow; a registration pause only stops new registrations.', keys: ['OR3_AUTH_REGISTRATION_MODE'], to: '/admin/registration', action: 'Registration controls' },
];
onMounted(async () => { try { entries.value = (await $fetch<{ entries: typeof entries.value }>('/api/admin/system/config/enriched')).entries; } catch { error.value = 'Resource settings unavailable. No policy values have been inferred.'; } });
</script>
