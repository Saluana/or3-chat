<template>
    <div class="p-5 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-lg font-medium">Provider checks</h3>
            <UButton size="sm" color="neutral" variant="soft" :loading="checking" @click="refreshChecks">Refresh checks</UButton>
        </div>
        <p v-if="error" role="alert" class="mb-3 text-sm text-[var(--md-error)]">{{ error }}</p>
        <div class="space-y-4 text-sm">
            <div v-for="kind in kinds" :key="kind" class="border-b border-[var(--md-outline-variant)] pb-3">
                <div class="flex flex-wrap justify-between gap-2"><strong>{{ kind }} · {{ providers[kind].provider }}</strong><span>{{ providers[kind].enabled ? 'Enabled' : 'Disabled' }} · {{ providers[kind].check?.result ?? 'unknown' }}</span></div>
                <p class="mt-1 text-xs opacity-70">{{ providers[kind].check?.kind ?? 'No probe available' }} · {{ providers[kind].check?.scope ?? kind }} · {{ formatTime(providers[kind].check?.checkedAt) }}</p>
                <p v-if="providers[kind].check" class="text-xs opacity-70">{{ providers[kind].check?.code }}</p>
            </div>
            <div>
                <strong>Background recovery · {{ status.backgroundStreaming.enabled ? 'Enabled' : 'Disabled' }}</strong>
                <dl v-if="status.backgroundStreaming.recovery" class="mt-2 grid grid-cols-2 gap-1 text-xs">
                    <dt>Last attempt</dt><dd>{{ formatTime(status.backgroundStreaming.recovery.lastAttemptAt) }}</dd>
                    <dt>Last successful scan</dt><dd>{{ formatTime(status.backgroundStreaming.recovery.lastSuccessAt) }}</dd>
                    <dt>Latest failure</dt><dd>{{ formatTime(status.backgroundStreaming.recovery.latestFailureAt) }}</dd>
                </dl>
                <p class="mt-1 text-xs opacity-70">Observed in this server process; resets at restart. A completed scan does not mean every job has recovered.</p>
            </div>
        </div>

        <AdminSystemWarnings :warnings="warnings" :storage="status.storage" class="mt-6" />
    </div>
</template>

<script setup lang="ts">
import type { StatusResponse, SystemStatus } from '~/composables/admin/useAdminTypes';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { formatTime } from '~/utils/admin/customer-display';
import AdminSystemWarnings from './AdminSystemWarnings.vue';

const props = defineProps<{
    status: SystemStatus;
    warnings: StatusResponse['warnings'];
}>();
const kinds = ['auth', 'sync', 'storage'] as const;
const fresh = ref<SystemStatus | null>(null);
const providers = computed(() => fresh.value ?? props.status);
const checking = ref(false);
const error = ref('');
async function refreshChecks() {
    checking.value = true;
    error.value = '';
    try {
        const result = await $fetch<{ providers: Pick<SystemStatus, 'auth' | 'sync' | 'storage'> }>('/api/admin/system/checks', { method: 'POST', headers: ADMIN_HEADERS });
        fresh.value = { ...props.status, ...result.providers };
    } catch { error.value = 'Checks could not be refreshed. Previous observations are kept.'; }
    finally { checking.value = false; }
}
</script>
