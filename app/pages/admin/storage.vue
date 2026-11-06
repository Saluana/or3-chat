<template>
    <div class="space-y-6">
        <div>
            <p class="text-xs font-medium uppercase tracking-wide opacity-60">Operations</p>
            <h1 class="text-2xl font-semibold">Storage</h1>
            <p class="text-sm opacity-70">Logical storage charged to customer allowances, and where to measure physical usage.</p>
        </div>

        <UAlert v-if="!billingEnabled" color="neutral" variant="soft" title="Account storage accounting is part of hosted billing"
            description="This deployment has no account allowances. Workspace file limits are set per workspace; physical usage can be inspected from Operations." >
            <template #actions><UButton to="/admin/system" color="neutral" variant="soft">Open Operations</UButton></template>
        </UAlert>

        <section class="space-y-3 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-4">
            <h2 class="font-semibold">Upload policy &amp; capacity</h2>
            <p class="text-sm opacity-70">Choose a workspace to edit its enforced upload size. Allowed file types and the deployment workspace cap are read-only deployment settings in Advanced Settings. Capacity warnings use an explicitly measured host volume; unknown capacity remains unknown.</p>
            <div class="flex flex-wrap gap-2"><UButton color="neutral" variant="soft" @click="chooseWorkspace = true">Choose workspace file settings</UButton><UButton to="/admin/advanced" color="neutral" variant="soft">Types, caps &amp; warning thresholds</UButton><UButton to="/admin/system#storage-usage" color="neutral" variant="soft">Measure physical usage</UButton></div>
            <FileCacheSettings v-if="selectedWorkspace" :workspace-id="selectedWorkspace" />
            <StorageGenerationPreview v-if="selectedWorkspace" :workspace-id="selectedWorkspace" />
            <WorkspaceSelector v-model="chooseWorkspace" description="Choose a workspace to edit its upload size and device-copy settings." @select="selectedWorkspace = $event.id" />
        </section>
        <template v-if="billingEnabled">
            <UAlert v-if="error" color="error" title="Storage accounting unavailable" :description="`${error} Usage is unknown, not zero.`">
                <template #actions><UButton color="neutral" variant="soft" @click="load">Try again</UButton></template>
            </UAlert>
            <div v-else-if="!data" class="h-24 animate-pulse rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-highest)]" role="status" aria-label="Loading storage" />

            <template v-if="data">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div class="tile">
                        <div class="tile-label">Charged to allowances</div>
                        <div class="tile-value">{{ formatBytes(data.summary.chargedBytes) }}</div>
                        <div class="tile-note">Retained files plus reserved uploads</div>
                    </div>
                    <div class="tile">
                        <div class="tile-label">Reserved uploads</div>
                        <div class="tile-value">{{ formatBytes(data.summary.reservedBytes) }}</div>
                        <div class="tile-note">{{ formatBytes(data.summary.expiredReservedBytes) }} from expired upload links</div>
                    </div>
                    <div class="tile">
                        <div class="tile-label">In deleted workspaces</div>
                        <div class="tile-value">{{ formatBytes(data.summary.deletedWorkspaceBytes) }}</div>
                        <div class="tile-note">Retained for recovery and still charged</div>
                    </div>
                    <div class="tile">
                        <div class="tile-label">Physical storage</div>
                        <div class="tile-value">Not measured</div>
                        <div class="tile-note">Opening this page never scans storage. <NuxtLink to="/admin/system" class="underline">Measure from Operations</NuxtLink>.</div>
                    </div>
                </div>
                <p class="text-xs opacity-60">Observed {{ formatTime(data.summary.observedAt) }} from the canonical database. 1 GB = 1,000,000,000 bytes.</p>

                <div class="overflow-hidden rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-4">
                    <h2 class="mb-3 font-semibold">Charged storage breakdown</h2>
                    <div class="flex h-4 w-full overflow-hidden rounded bg-[var(--md-surface-container-high)]" role="img" :aria-label="breakdownLabel">
                        <div v-for="part in parts" :key="part.label" :style="{ width: `${part.percent}%` }" :class="part.class" />
                    </div>
                    <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                        <li v-for="part in parts" :key="part.label" class="flex items-start gap-2">
                            <span class="mt-1 inline-block size-3 shrink-0 rounded-sm" :class="part.class" aria-hidden="true" />
                            <span><strong>{{ part.label }}</strong> {{ formatBytes(part.bytes) }} ({{ part.percent.toFixed(1) }}%)<br><span class="opacity-70">{{ part.note }}</span></span>
                        </li>
                    </ul>
                </div>

                <UAlert color="warning" variant="soft" title="Deleted files remain charged until safe reclamation is supported"
                    description="Deleting a file or workspace, or letting an upload link expire, does not release charged bytes. Supported remedies: raise the global allowance, add storage to one account, or grant temporary access." />

                <div class="grid gap-4 lg:grid-cols-2">
                    <div class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-4 text-sm">
                        <h2 class="mb-2 font-semibold">Allowances</h2>
                        <dl class="facts">
                            <dt>Trial allowance (per account)</dt><dd>{{ data.settings.trialStorageGb }} GB</dd>
                            <dt>Paid allowance (per account)</dt><dd>{{ data.settings.paidStorageGb }} GB</dd>
                            <dt>Workspace cap (every workspace)</dt><dd>{{ data.workspaceCapBytes ? formatBytes(data.workspaceCapBytes) : 'None' }}</dd>
                        </dl>
                        <p class="mt-2 opacity-70">Account allowances cover every workspace the account owns. The workspace cap comes from <code>OR3_STORAGE_WORKSPACE_QUOTA_BYTES</code> and changes need a restart. Per-workspace file size and type limits are in each workspace's file settings.</p>
                        <UButton class="mt-3" to="/admin/extensions/hosted-billing" color="neutral" variant="soft">Change allowances (with impact preview)</UButton>
                    </div>
                    <div class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-4 text-sm">
                        <h2 class="mb-2 font-semibold">New uploads</h2>
                        <p class="opacity-80">Pausing new uploads deployment-wide is in Advanced Settings → Service pauses. Downloads and uploads already admitted continue.</p>
                        <UButton class="mt-3" to="/admin/advanced#pauses" color="neutral" variant="soft">Open service pauses</UButton>
                    </div>
                </div>

                <section aria-labelledby="largest-heading" class="space-y-2">
                    <h2 id="largest-heading" class="text-lg font-semibold">Largest accounts</h2>
                    <div class="overflow-x-auto rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)]">
                        <table class="w-full min-w-[640px] text-sm">
                            <thead class="bg-[var(--md-surface-container-low)] text-left">
                                <tr>
                                    <th scope="col" class="p-3 font-medium">Account</th>
                                    <th scope="col" class="p-3 font-medium">Charged</th>
                                    <th scope="col" class="p-3 font-medium">Allowance</th>
                                    <th scope="col" class="p-3 font-medium">Usage</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in data.largest" :key="row.userId" class="border-t border-[var(--md-outline-variant)]">
                                    <td class="p-3"><NuxtLink :to="`/admin/customers/${encodeURIComponent(row.userId)}`" class="font-mono text-xs underline-offset-2 hover:underline">{{ row.userId }}</NuxtLink></td>
                                    <td class="p-3">{{ formatBytes(row.chargedBytes) }}</td>
                                    <td class="p-3">{{ row.access.nominalStorageLimitBytes ? formatBytes(row.access.nominalStorageLimitBytes) : 'No entitlement' }}</td>
                                    <td class="p-3">
                                        <template v-if="row.access.nominalStorageLimitBytes">
                                            <div class="flex items-center gap-2">
                                                <div class="h-2 w-24 overflow-hidden rounded bg-[var(--md-surface-container-high)]"><div class="h-full" :class="ratio(row) >= 1 ? 'bg-[var(--md-error)]' : 'bg-[var(--md-primary)]'" :style="{ width: `${Math.min(100, ratio(row) * 100)}%` }" /></div>
                                                <span>{{ Math.round(ratio(row) * 100) }}%</span>
                                            </div>
                                        </template>
                                        <span v-else class="opacity-60">—</span>
                                    </td>
                                </tr>
                                <tr v-if="!data.largest.length"><td colspan="4" class="p-3 opacity-70">No charged storage yet.</td></tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import StorageGenerationPreview from '~/components/admin/StorageGenerationPreview.vue';
import FileCacheSettings from '~/components/admin/FileCacheSettings.vue';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';
import { formatBytes, formatTime } from '~/utils/admin/customer-display';

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });

interface StorageData {
    summary: { chargedBytes: number; retainedBytes: number; reservedBytes: number; expiredReservedBytes: number; deletedWorkspaceBytes: number; activeWorkspaceRetainedBytes: number; activeWorkspaceReservedBytes: number; observedAt: number };
    workspaceCapBytes: number | null;
    settings: { trialStorageGb: number; paidStorageGb: number };
    largest: Array<{ userId: string; chargedBytes: number; access: { nominalStorageLimitBytes: number } }>;
}
const chooseWorkspace = ref(false);
const selectedWorkspace = ref('');
const billingEnabled = useRuntimeConfig().public.hostedBillingEnabled === true;
const data = ref<StorageData | null>(null);
const error = ref('');
const { getMessage } = useApiError();

const ratio = (row: StorageData['largest'][number]) => row.chargedBytes / row.access.nominalStorageLimitBytes;
const parts = computed(() => {
    const summary = data.value?.summary;
    if (!summary) return [];
    const total = summary.chargedBytes || 1;
    // The server partitions charged bytes, so the parts never overlap.
    return [
        { label: 'Active workspaces', bytes: summary.activeWorkspaceRetainedBytes, note: 'Stored files, including files in Trash', class: 'bg-[var(--md-primary)]' },
        { label: 'Deleted workspaces', bytes: summary.deletedWorkspaceBytes, note: 'Files and upload reservations retained for recovery', class: 'bg-[var(--md-primary)] opacity-50' },
        { label: 'Reserved uploads', bytes: summary.activeWorkspaceReservedBytes, note: 'In progress or expired upload links in active workspaces', class: 'bg-[var(--md-outline-variant)]' },
    ].map(part => ({ ...part, percent: (part.bytes / total) * 100 }));
});
const breakdownLabel = computed(() => parts.value.map(part => `${part.label} ${formatBytes(part.bytes)}`).join(', '));

async function load() {
    error.value = '';
    try { data.value = await $fetch<StorageData>('/api/admin/hosted-billing/storage', { credentials: 'include' }); }
    catch (err) { error.value = getMessage(err) || 'Try again.'; }
}
onMounted(() => { if (billingEnabled) void load(); });
</script>

<style scoped>
.tile { border: 1px solid var(--md-outline-variant); border-radius: var(--md-border-radius); background: var(--md-surface); padding: 1rem; }
.tile-label { font-size: 0.875rem; opacity: 0.7; }
.tile-value { font-size: 1.5rem; font-weight: 600; }
.tile-note { font-size: 0.75rem; opacity: 0.7; }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; }
.facts dt { opacity: 0.7; }
.facts dd { text-align: right; }
</style>
