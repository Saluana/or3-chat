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

            <div v-if="preview" class="mt-4 rounded-[var(--md-sys-shape-corner-small,8px)] border border-[var(--md-outline-variant)] p-3 text-sm">
                <p class="font-medium">Preview: install OR3 {{ preview.target.appVersion }}</p>
                <p v-if="blockers.length" role="alert" aria-live="assertive" class="mt-2 text-[var(--md-sys-color-error,#b91c1c)]">
                    Blocked: {{ blockers.map((finding) => finding.message).join(' ') }}
                </p>
                <p v-else class="mt-2 opacity-70">No blockers found. Data is backed up before replacement.</p>
                <p v-if="preview.retention.remove.length" class="mt-2 opacity-70">
                    Cleanup would prune {{ preview.retention.remove.length }} backup(s); the rollback point and protected sources are preserved.
                </p>
                <p v-if="deferredChecks.length" class="mt-2 opacity-60">
                    Deferred to execution: {{ deferredChecks.map((check) => check.code).join(', ') }}.
                </p>
            </div>

            <div v-else-if="previewError" role="alert" aria-live="polite" class="mt-4 rounded-[var(--md-sys-shape-corner-small,8px)] border border-[var(--md-outline-variant)] p-3 text-sm">
                <p>Update preview unavailable: {{ previewError }}</p>
                <p class="mt-1 opacity-70">Updating is still possible because execution revalidates every check before changing anything, but preview the change or retry first.</p>
                <UButton class="mt-2" size="xs" color="neutral" variant="soft" :loading="previewing" :disabled="busy" @click="loadPreview">
                    Retry preview
                </UButton>
            </div>

            <p v-if="status.job && ['queued', 'running'].includes(status.job.phase)" role="status" aria-live="polite" class="mt-4 text-sm text-[var(--md-primary)]">
                Updating to {{ status.job.targetVersion }}. OR3 will briefly restart while the verified update runs.
            </p>
            <p v-if="reconnecting && activeJob" role="status" aria-live="polite" class="mt-2 text-sm opacity-70">
                Reconnecting to the running update. The accepted job {{ activeJob.id.slice(0, 8) }} keeps running; do not start another update.
            </p>
            <p v-if="pollingExpired && activeJob" role="status" aria-live="polite" class="mt-2 text-sm opacity-70">
                Automatic status polling stopped after 15 minutes. Refresh this page to resume observing the accepted update.
            </p>
            <p v-else-if="status.job && ['failed', 'needs_attention'].includes(status.job.phase)" role="alert" aria-live="assertive" class="mt-4 text-sm text-[var(--md-sys-color-error,#b91c1c)]">
                {{ status.job.error || 'The previous update did not complete.' }}
            </p>
            <p v-else-if="status.checkError" role="alert" aria-live="assertive" class="mt-4 text-sm text-[var(--md-sys-color-error,#b91c1c)]">
                {{ status.checkError }}
            </p>
            <p v-else-if="status.job?.phase === 'succeeded' || status.updateAvailable === false" class="mt-4 text-sm opacity-70">
                OR3 {{ status.job?.targetVersion || status.currentVersion }} is installed.
            </p>
            <p v-else-if="status.updateAvailable" class="mt-4 text-sm text-[var(--md-primary)]">Version {{ status.latestVersion }} is ready.</p>

            <div v-if="receiptWarnings.length || receiptGaps.length || needsAttention" role="status" aria-live="polite" class="mt-4 rounded-[var(--md-sys-shape-corner-small,8px)] bg-[var(--md-surface-container-low)] p-3 text-sm">
                <p v-if="needsAttention" class="text-[var(--md-sys-color-error,#b91c1c)]">
                    The application is healthy, but the dashboard operator needs host attention. Run <code>npx @or3/cloud recover --finish</code> on the host.
                </p>
                <p v-for="warning in receiptWarnings" :key="warning.code" class="mt-1">Cleanup warning: {{ warning.message }}</p>
                <p v-if="receiptGaps.length" class="mt-1 opacity-70">Not verified: {{ receiptGaps.map((check) => check.code).join(', ') }}.</p>
            </div>

            <div class="mt-5 flex flex-wrap gap-3">
                <UButton color="neutral" variant="soft" :loading="checking" :disabled="busy" @click="check">
                    Check for updates
                </UButton>
                <UButton
                    v-if="status.updateAvailable && status.latestVersion && !blockers.length"
                    color="primary"
                    icon="i-heroicons-arrow-up-circle"
                    :loading="starting"
                    :disabled="busy || !isOwner || needsAttention"
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
import type { DashboardUpdatePreview, DashboardUpdateStatus } from '~/composables/admin/useAdminTypes';
import { parseErrorMessage } from '~/utils/admin/parse-error';

const props = defineProps<{ isOwner: boolean }>();
const status = ref<DashboardUpdateStatus>();
const preview = ref<DashboardUpdatePreview['preview']['assessment']>();
const previewError = ref('');
const loading = ref(true);
const checking = ref(false);
const starting = ref(false);
const previewing = ref(false);
const reconnecting = ref(false);
const pollingExpired = ref(false);
const busy = computed(() => checking.value || starting.value || previewing.value || Boolean(status.value?.kind === 'managed' && status.value.job && ['queued', 'running'].includes(status.value.job.phase)));
const activeJob = computed(() => status.value?.kind === 'managed' && status.value.job && ['queued', 'running'].includes(status.value.job.phase) ? status.value.job : undefined);
const blockers = computed(() => (preview.value?.findings || []).filter((finding) => finding.severity === 'blocker'));
const deferredChecks = computed(() => (preview.value?.checks || []).filter((check) => check.status === 'deferred' || check.status === 'unknown'));
const receiptWarnings = computed(() => status.value?.kind === 'managed' ? status.value.receipt?.warnings || [] : []);
const receiptGaps = computed(() => status.value?.kind === 'managed' ? (status.value.receipt?.checks || []).filter((check) => check.status === 'deferred' || check.status === 'unknown') : []);
const needsAttention = computed(() => status.value?.kind === 'managed' && status.value.receipt?.operatorHandoff === 'needs-attention');
const toast = useToast();
const { confirm } = useConfirmDialog();
const ACTIVE_POLL_MS = 2000;
const MAX_POLL_BACKOFF_MS = 30_000;
const MAX_ACTIVE_POLL_MS = 15 * 60_000;
let pollingTimer: ReturnType<typeof setTimeout> | undefined;
let pollingStartedAt = 0;
let pollingFailures = 0;

function stopPolling() {
    if (pollingTimer) clearTimeout(pollingTimer);
    pollingTimer = undefined;
    pollingStartedAt = 0;
    pollingFailures = 0;
}

function updatePolling() {
    const running = activeJob.value;
    if (!running) return stopPolling();
    if (!pollingStartedAt) pollingStartedAt = Date.now();
    if (Date.now() - pollingStartedAt >= MAX_ACTIVE_POLL_MS) {
        pollingExpired.value = true;
        return stopPolling();
    }
    if (pollingTimer) return;
    const delay = Math.min(ACTIVE_POLL_MS * (2 ** pollingFailures), MAX_POLL_BACKOFF_MS);
    pollingTimer = setTimeout(() => {
        pollingTimer = undefined;
        void loadStatus(true);
    }, delay);
}

async function loadStatus(silent = false) {
    try {
        status.value = await $fetch<DashboardUpdateStatus>('/api/admin/update/status', { headers: ADMIN_HEADERS });
        pollingFailures = 0;
        reconnecting.value = false;
        pollingExpired.value = false;
    } catch (error) {
        if (silent) {
            pollingFailures += 1;
            reconnecting.value = Boolean(activeJob.value);
        } else {
            toast.add({ title: 'Update status unavailable', description: parseErrorMessage(error, 'Could not reach the update service.'), color: 'error' });
        }
    } finally {
        loading.value = false;
        updatePolling();
    }
}

async function loadPreview() {
    if (status.value?.kind !== 'managed' || !status.value.latestVersion) return;
    previewing.value = true;
    previewError.value = '';
    try {
        const response = await $fetch<DashboardUpdatePreview>('/api/admin/update/preview', { method: 'POST', headers: ADMIN_HEADERS });
        preview.value = response.preview.assessment;
    } catch (error) {
        // The preview is advisory, but a silent failure hides an incompatible
        // operator. Surface it with a retry path; execution still revalidates.
        preview.value = undefined;
        previewError.value = parseErrorMessage(
            error,
            'The dashboard operator did not return an update preview. Check the version compatibility and retry.'
        );
    } finally {
        previewing.value = false;
    }
}

async function check() {
    checking.value = true;
    try {
        status.value = await $fetch<DashboardUpdateStatus>('/api/admin/update/check', { method: 'POST', headers: ADMIN_HEADERS });
        if (status.value?.kind === 'managed' && status.value.updateAvailable) {
            await loadPreview();
        } else {
            preview.value = undefined;
            previewError.value = '';
        }
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
        preview.value = undefined;
        previewError.value = '';
        updatePolling();
        toast.add({ title: 'Update started', description: `Updating to ${targetVersion}. This page will check again after OR3 restarts.`, color: 'success' });
    } catch (error) {
        toast.add({ title: 'Update could not start', description: parseErrorMessage(error, 'Try checking for updates again.'), color: 'error' });
    } finally {
        starting.value = false;
    }
}

onMounted(loadStatus);
onUnmounted(stopPolling);
</script>
