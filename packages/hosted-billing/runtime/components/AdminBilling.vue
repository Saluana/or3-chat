<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { UAlert, UButton, UFormField, UInput } from '#components';
import type { BillingSettings } from '../types';
import { $fetch } from 'ofetch';
import AdminOffers from './AdminOffers.vue';
import BillingHealth from './BillingHealth.vue';
type Tab = 'overview' | 'reviews' | 'processing' | 'offers';
const tabs: Array<{ id: Tab; label: string }> = [{ id: 'overview', label: 'Overview & allowances' }, { id: 'reviews', label: 'Review queue' }, { id: 'processing', label: 'Processing' }, { id: 'offers', label: 'Accepted offers' }];
const tab = ref<Tab>('overview');
const form = reactive<BillingSettings>({ trialStorageGb: 1, paidStorageGb: 50, revision: 0 });
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saved = ref(false);
const reason = ref('');
let operationId = '';
watch(() => [form.trialStorageGb, form.paidStorageGb], () => { impact.value = null; operationId = ''; saved.value = false; });
watch(reason, () => { operationId = ''; });
interface Impact { revision: number; measuredAt: number; proposed: { trialStorageGb: number; paidStorageGb: number }; impact: Record<'paid' | 'trial', { accounts: number; over: number; newlyOver: number }>; examples: Array<{ userId: string; cohort: string; chargedBytes: number; proposedLimitBytes: number }> }
const impact = ref<Impact | null>(null);
const impactError = ref('');
const previewing = ref(false);
const gb = (bytes: number) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_000_000_000)} GB`;
async function preview() {
    previewing.value = true;
    impactError.value = '';
    try {
        impact.value = await $fetch<Impact>('/api/admin/hosted-billing/quota-impact', { query: { trialStorageGb: form.trialStorageGb, paidStorageGb: form.paidStorageGb }, retry: 0 });
        if (impact.value.proposed.trialStorageGb !== form.trialStorageGb || impact.value.proposed.paidStorageGb !== form.paidStorageGb) { impact.value = null; impactError.value = 'Values changed while previewing. Preview the current values again.'; return; }
        if (impact.value.revision !== form.revision) impactError.value = 'Settings changed since this page loaded. Reload before saving.';
    } catch { impactError.value = 'Impact is unknown: storage accounting could not be read.'; impact.value = null; }
    finally { previewing.value = false; }
}
async function load() {
    loading.value = true;
    error.value = '';
    try { Object.assign(form, await $fetch<BillingSettings>('/api/admin/hosted-billing', { retry: 0 })); }
    catch { error.value = 'Could not load billing settings. Global administrator access is required.'; }
    finally { loading.value = false; }
}
async function save() {
    if (!impact.value || impact.value.revision !== form.revision) { error.value = 'Preview the current allowance impact before saving.'; return; }
    operationId ||= crypto.randomUUID();
    saving.value = true;
    saved.value = false;
    error.value = '';
    try {
        Object.assign(form, await $fetch<BillingSettings>('/api/admin/hosted-billing', {
            method: 'POST', headers: { 'x-or3-admin-intent': 'admin' }, body: { ...form, reason: reason.value, operationId }, retry: 0,
        }));
        saved.value = true;
        reason.value = ''; operationId = ''; impact.value = null;
    } catch { error.value = 'Could not save. Check the limits, or reload if another administrator changed them.'; }
    finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
    <div class="space-y-5">
    <div role="tablist" aria-label="Hosted billing" class="flex flex-wrap gap-2">
        <UButton v-for="item in tabs" :id="`billing-tab-${item.id}`" :key="item.id" role="tab" :aria-selected="tab === item.id" :aria-controls="`billing-panel-${item.id}`"
            :variant="tab === item.id ? 'solid' : 'soft'" :color="tab === item.id ? 'primary' : 'neutral'" @click="tab = item.id">{{ item.label }}</UButton>
    </div>
    <div :id="`billing-panel-${tab}`" role="tabpanel" :aria-labelledby="`billing-tab-${tab}`">
        <AdminOffers v-if="tab === 'offers'" @changed="load" />
        <BillingHealth v-else :key="tab" :view="tab" />
    </div>
    <form v-show="tab === 'overview'" class="billing-settings space-y-5" @submit.prevent="save">
        <h2 class="text-lg font-semibold">Storage allowances</h2>
        <p class="text-muted">These allowances apply to the current offer cohort across all workspaces owned by each account. Historical cohorts retain their accepted allowances.</p>
        <p v-if="loading" role="status">Loading settings…</p>
        <UAlert v-if="error" color="error" title="Billing settings unavailable" :description="error" />
        <template v-if="form.revision">
            <UFormField label="Trial storage (GB)" name="trialStorageGb" required>
                <UInput v-model.number="form.trialStorageGb" type="number" :min="1" :max="1000000" :step="1" required :disabled="saving" />
            </UFormField>
            <UFormField label="Paid storage (GB)" name="paidStorageGb" required>
                <UInput v-model.number="form.paidStorageGb" type="number" :min="1" :max="1000000" :step="1" required :disabled="saving" />
            </UFormField>
            <p class="text-sm text-muted">1 GB = 1 billion bytes. Changes apply to subsequent upload requests without a restart. Existing files and authorized uploads are preserved. Deleted files still count toward storage. Accounts over the limit need a higher allowance to upload more.</p>
            <UButton type="button" color="neutral" variant="soft" :loading="previewing" :disabled="saving || loading" @click="preview">Preview impact</UButton>
            <div v-if="impact" role="status" class="rounded border border-[var(--md-outline-variant)] p-3 text-sm">
                <p class="font-medium">Measured {{ new Date(impact.measuredAt).toLocaleString() }}</p>
                <p>Paid accounts: {{ impact.impact.paid.accounts }} · over the proposed limit {{ impact.impact.paid.over }} ({{ impact.impact.paid.newlyOver }} newly)</p>
                <p>Trial accounts: {{ impact.impact.trial.accounts }} · over the proposed limit {{ impact.impact.trial.over }} ({{ impact.impact.trial.newlyOver }} newly)</p>
                <ul v-if="impact.examples.length" class="mt-2 list-disc pl-5">
                    <li v-for="example in impact.examples" :key="example.userId">
                        <a :href="`/admin/customers/${encodeURIComponent(example.userId)}`" class="underline">{{ example.userId }}</a> ({{ example.cohort }}): {{ gb(example.chargedBytes) }} charged vs {{ gb(example.proposedLimitBytes) }}
                    </li>
                </ul>
                <p class="mt-2 text-muted">Over-limit accounts keep every file and can still download. They cannot upload more until usage or their allowance changes. Usage may change before you save; admission always checks live usage.</p>
            </div>
            <UAlert v-if="impactError" color="warning" :title="impactError" />
            <UFormField label="Reason for storage allowance change" required><UInput v-model="reason" required maxlength="500" :disabled="saving" /></UFormField>
            <UButton type="submit" :loading="saving" :disabled="loading || !impact || !reason.trim()">Save storage limits</UButton>
            <p v-if="saved" role="status" class="text-sm">Storage limits saved.</p>
        </template>
        <UButton type="button" color="neutral" variant="ghost" :disabled="saving || loading" @click="load">Reload settings</UButton>
    </form>
    </div>
</template>

<style scoped>
.billing-settings { max-width: 38rem; }
</style>
