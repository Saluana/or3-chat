<template>
    <section class="space-y-3 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-5" aria-labelledby="recovery-heading">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="recovery-heading" class="text-lg font-semibold">Backup &amp; recovery evidence</h2><UButton color="neutral" variant="soft" size="sm" :loading="pending" @click="load">Refresh receipts</UButton></div>
        <p v-if="!result" role="status">Loading recovery evidence…</p>
        <p v-else-if="!result.available" class="text-sm">{{ result.reason }}</p>
        <template v-else>
            <p class="text-sm">{{ result.recovery.snapshot ? `Last operator-reported rollback snapshot: ${result.recovery.snapshot.id} · ${result.recovery.snapshot.capturedAt ?? 'capture time unknown'}` : 'No rollback snapshot reported.' }}</p>
            <p class="text-xs opacity-70">Observed {{ result.recovery.observedAt }} from the managed operator. The snapshot has not been re-verified by this page.</p>
            <dl class="grid gap-2 text-sm sm:grid-cols-2"><div v-for="row in result.recovery.coverage" :key="row.component" class="flex justify-between gap-3 border-b border-[var(--md-outline-variant)] py-2"><dt>{{ labels[row.component] }}</dt><dd>Unknown</dd></div></dl>
            <p class="text-sm">Last recovery test: unknown. Application health does not verify a backup, credential escrow, or an independent copy.</p>
            <UAlert v-if="result.recovery.incompleteOperation" color="warning" title="Incomplete managed operation" :description="`${result.recovery.incompleteOperation.operation} · ${result.recovery.incompleteOperation.id}. Inspect with the managed CLI before retrying.`" />
        </template>
        <p class="text-xs opacity-70">On the deployment host, use the exact installed version of <code>@or3/cloud</code>: <code>status</code>, <code>doctor</code>, and <code>backup list</code>. Verify archive checksums, billing data and the trial hash key, credential escrow, off-host copies and a disposable recovery drill separately. Source deployments use the documented manual backup procedure.</p>
        <UButton to="/documentation/cloud/operations" color="neutral" variant="link">Cloud operations documentation</UButton>
    </section>
</template>
<script setup lang="ts">
import type { RecoveryStatus } from '~~/server/admin/update/operator-client';
const result = ref<{ available: true; recovery: RecoveryStatus } | { available: false; reason: string } | null>(null);
const pending = ref(false);
const labels: Record<string, string> = { canonical: 'Canonical data', auth: 'Authentication', files: 'File originals', configuration: 'Configuration & managed assets', billing_trials_support: 'Billing, trials, support & audit', credential_escrow: 'Credential recovery keys', independent_copy: 'Independent backup copy' };
async function load() {
    pending.value = true;
    try { result.value = await $fetch<NonNullable<typeof result.value>>('/api/admin/system/recovery', { credentials: 'include' }); }
    catch { result.value = { available: false, reason: 'Recovery evidence could not be loaded. Verify backups on the host.' }; }
    finally { pending.value = false; }
}
onMounted(load);
</script>
