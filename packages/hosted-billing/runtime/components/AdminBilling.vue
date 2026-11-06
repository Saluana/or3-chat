<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { UAlert, UButton, UFormField, UInput } from '#components';
import type { BillingSettings } from '../types';
import { $fetch } from 'ofetch';
const form = reactive<BillingSettings>({ trialStorageGb: 1, paidStorageGb: 50, revision: 0 });
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saved = ref(false);
async function load() {
    loading.value = true;
    error.value = '';
    try { Object.assign(form, await $fetch<BillingSettings>('/api/admin/hosted-billing', { retry: 0 })); }
    catch { error.value = 'Could not load billing settings. Global administrator access is required.'; }
    finally { loading.value = false; }
}
async function save() {
    saving.value = true;
    saved.value = false;
    error.value = '';
    try {
        Object.assign(form, await $fetch<BillingSettings>('/api/admin/hosted-billing', {
            method: 'POST', headers: { 'x-or3-admin-intent': 'admin' }, body: { ...form }, retry: 0,
        }));
        saved.value = true;
    } catch { error.value = 'Could not save. Check the limits, or reload if another administrator changed them.'; }
    finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
    <form class="billing-settings space-y-5" @submit.prevent="save">
        <p class="text-muted">7-day no-card trial · $40 USD/year. These storage allowances apply across all workspaces owned by an account.</p>
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
            <UButton type="submit" :loading="saving" :disabled="loading">Save storage limits</UButton>
            <p v-if="saved" role="status" class="text-sm">Storage limits saved.</p>
        </template>
        <UButton type="button" color="neutral" variant="ghost" :disabled="saving || loading" @click="load">Reload settings</UButton>
    </form>
</template>

<style scoped>
.billing-settings { max-width: 38rem; }
</style>
