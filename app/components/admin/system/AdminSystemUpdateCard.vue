<template>
    <section class="rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-5">
        <div class="flex items-start justify-between gap-4">
            <div>
                <h3 class="text-lg font-medium">Dashboard Update</h3>
                <p class="mt-1 text-sm opacity-70">
                    Install the latest verified OR3 release. Your data is backed up and the previous release is restored if health checks fail.
                </p>
            </div>
            <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 shrink-0 opacity-60" />
        </div>

        <p v-if="loading" class="mt-5 text-sm opacity-60">Checking managed deployment…</p>

        <template v-else-if="status?.kind === 'unsupported' || status?.kind === 'unavailable'">
            <p class="mt-5 text-sm opacity-70">{{ status.reason }}</p>
        </template>

        <template v-else-if="status?.kind === 'managed'">
            <div class="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div class="rounded-[var(--md-sys-shape-corner-small,8px)] bg-[var(--md-surface-container-low)] p-3">
                    <span class="block text-xs uppercase tracking-wide opacity-60">Installed</span>
                    <span class="mt-1 block font-medium">{{ status.currentVersion || 'Unknown' }}</span>
                </div>
                <div class="rounded-[var(--md-sys-shape-corner-small,8px)] bg-[var(--md-surface-container-low)] p-3">
                    <span class="block text-xs uppercase tracking-wide opacity-60">Latest</span>
                    <span class="mt-1 block font-medium">{{ status.latestVersion || 'Check for updates' }}</span>
                </div>
            </div>

            <p v-if="status.job && ['queued', 'running'].includes(status.job.phase)" class="mt-4 text-sm text-[var(--md-primary)]">
                Updating to {{ status.job.targetVersion }}. OR3 will briefly restart while the verified update runs.
            </p>
            <p v-else-if="status.job && ['failed', 'needs_attention'].includes(status.job.phase)" class="mt-4 text-sm text-[var(--md-sys-color-error,#b91c1c)]">
                {{ status.job.error || 'The previous update did not complete.' }}
            </p>
            <p v-else-if="status.checkError" class="mt-4 text-sm text-[var(--md-sys-color-error,#b91c1c)]">
                {{ status.checkError }}
            </p>
            <p v-else-if="status.updateAvailable === false" class="mt-4 text-sm opacity-70">You are up to date.</p>
            <p v-else-if="status.updateAvailable" class="mt-4 text-sm text-[var(--md-primary)]">Version {{ status.latestVersion }} is ready.</p>

            <div class="mt-5 flex flex-wrap gap-3">
                <UButton color="neutral" variant="soft" :loading="checking" :disabled="busy" @click="check">
                    Check for updates
                </UButton>
                <UButton
                    v-if="status.updateAvailable && status.latestVersion"
                    color="primary"
                    icon="i-heroicons-arrow-up-circle"
                    :loading="starting"
                    :disabled="busy || !isOwner"
                    @click="start"
                >
                    Update to {{ status.latestVersion }}
                </UButton>
            </div>
        </template>
    </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import type { DashboardUpdateStatus } from '~/composables/admin/useAdminTypes';
import { parseErrorMessage } from '~/utils/admin/parse-error';

const props = defineProps<{ isOwner: boolean }>();
const status = ref<DashboardUpdateStatus>();
const loading = ref(true);
const checking = ref(false);
const starting = ref(false);
const busy = computed(() => checking.value || starting.value || Boolean(status.value?.kind === 'managed' && status.value.job && ['queued', 'running'].includes(status.value.job.phase)));
const toast = useToast();
const { confirm } = useConfirmDialog();
let pollingTimer: ReturnType<typeof setInterval> | undefined;

function updatePolling() {
    const running = status.value?.kind === 'managed' && status.value.job && ['queued', 'running'].includes(status.value.job.phase);
    if (running && !pollingTimer) {
        pollingTimer = setInterval(() => void loadStatus(true), 5000);
    } else if (!running && pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = undefined;
    }
}

async function loadStatus(silent = false) {
    try {
        status.value = await $fetch<DashboardUpdateStatus>('/api/admin/update/status', { headers: ADMIN_HEADERS });
    } catch (error) {
        if (!silent) toast.add({ title: 'Update status unavailable', description: parseErrorMessage(error, 'Could not reach the update service.'), color: 'error' });
    } finally {
        loading.value = false;
        updatePolling();
    }
}

async function check() {
    checking.value = true;
    try {
        status.value = await $fetch<DashboardUpdateStatus>('/api/admin/update/check', { method: 'POST', headers: ADMIN_HEADERS });
    } catch (error) {
        toast.add({ title: 'Could not check for updates', description: parseErrorMessage(error, 'Try again shortly.'), color: 'error' });
    } finally {
        checking.value = false;
    }
}

async function start() {
    if (!props.isOwner || status.value?.kind !== 'managed' || !status.value.latestVersion) return;
    const targetVersion = status.value.latestVersion;
    const approved = await confirm({
        title: `Update OR3 to ${targetVersion}?`,
        message: 'OR3 will create a verified backup, update, run health checks, and automatically restore the previous release if the update fails. The app will restart briefly.',
        confirmText: 'Update OR3',
    });
    if (!approved) return;
    starting.value = true;
    try {
        status.value = await $fetch<DashboardUpdateStatus>('/api/admin/update/start', {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: { requestId: crypto.randomUUID(), targetVersion },
        });
        updatePolling();
        toast.add({ title: 'Update started', description: `Updating to ${targetVersion}. This page will check again after OR3 restarts.`, color: 'success' });
    } catch (error) {
        toast.add({ title: 'Update could not start', description: parseErrorMessage(error, 'Try checking for updates again.'), color: 'error' });
    } finally {
        starting.value = false;
    }
}

onMounted(loadStatus);
onUnmounted(() => pollingTimer && clearInterval(pollingTimer));
</script>
