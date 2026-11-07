<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { UAlert, UButton, UFormField, UInput } from '#components';
import { $fetch } from 'ofetch';
import type { BillingOffer } from '../server/store';
const emit = defineEmits<{ changed: [] }>();
type State = { revision: number; items: BillingOffer[]; cohorts: Array<{ offerId: string; accounts: number }>; impact: string };
const state = ref<State | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const validatedAt = ref<number | null>(null);
const form = reactive({ priceId: '', amountCents: 4000, paidStorageGb: 50, trialStorageGb: 1, trialDays: 7, reason: '' });
let operationId = '';
watch(form, () => { validatedAt.value = null; operationId = ''; });
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function failure(e: unknown) { return (e as { data?: { statusMessage?: string } })?.data?.statusMessage || 'The operation could not be verified. Reload before retrying.'; }
async function load() {
    busy.value = true;
    error.value = '';
    try { state.value = await $fetch<State>('/api/admin/hosted-billing/offers', { retry: 0 }); }
    catch (e) { error.value = failure(e); }
    finally { busy.value = false; }
}
async function change(preview: boolean, retireId?: string) {
    if (!state.value) return;
    busy.value = true; error.value = ''; notice.value = '';
    operationId ||= crypto.randomUUID();
    const { reason, ...terms } = form;
    try {
        const result = await $fetch<State & { validatedAt?: number }>('/api/admin/hosted-billing/offers', {
            method: 'POST', query: preview ? { preview: 'true' } : undefined, headers: { 'x-or3-admin-intent': 'admin' }, retry: 0,
            body: { operationId, reason, expectedRevision: state.value.revision, command: retireId ? { kind: 'retire', offerId: retireId } : { kind: 'create_current', ...terms } },
        });
        state.value = result;
        if (preview) validatedAt.value = result.validatedAt ?? null;
        else { validatedAt.value = null; operationId = ''; notice.value = 'Offer history updated. Existing subscriptions and trial deadlines were preserved.'; emit('changed'); }
    } catch (e) { error.value = failure(e); validatedAt.value = null; }
    finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
    <section class="space-y-4">
        <h2 class="text-lg font-semibold">Accepted annual offers</h2>
        <p class="text-sm">One offer is available for new Checkout sessions. Grandfathered and retired offers remain recognized for existing subscribers, including their invoices. Retiring an offer never cancels or migrates subscriptions.</p>
        <UAlert v-if="error" color="error" title="Offer change unavailable" :description="error" />
        <p v-if="notice" role="status">{{ notice }}</p>
        <div v-if="state" class="overflow-x-auto">
            <table class="w-full text-sm text-left"><thead><tr><th scope="col" class="p-2">Offer</th><th scope="col" class="p-2">Terms</th><th scope="col" class="p-2">Status</th><th scope="col" class="p-2">Matched accounts</th><th scope="col" class="p-2">Action</th></tr></thead>
                <tbody><tr v-for="offer in state.items" :key="offer.id" class="border-t border-[var(--md-outline-variant)]">
                    <td class="p-2">v{{ offer.version }}<div class="font-mono text-xs">{{ offer.priceId }}</div></td>
                    <td class="p-2">{{ money(offer.amountCents) }}/year · {{ offer.paidStorageGb }} GB<div>{{ offer.trialDays }}-day trial · {{ offer.trialStorageGb }} GB</div></td>
                    <td class="p-2">{{ offer.status }}</td><td class="p-2">{{ state.cohorts.find(cohort => cohort.offerId === offer.id)?.accounts ?? 0 }}</td>
                    <td class="p-2"><UButton v-if="offer.status === 'grandfathered'" color="neutral" variant="soft" :disabled="busy || !form.reason.trim()" @click="change(false, offer.id)">Retire from sale</UButton></td>
                </tr></tbody>
            </table>
        </div>
        <form v-if="state" class="max-w-xl space-y-3" @submit.prevent="change(true)">
            <h3 class="font-medium">New checkout offer</h3>
            <p class="text-sm">Use an existing active, fixed annual USD Stripe price. This action accepts its terms in OR3. It does not create or alter a Stripe price.</p>
            <UFormField label="Stripe price ID" required><UInput v-model="form.priceId" required :disabled="busy" /></UFormField>
            <UFormField label="Annual amount (USD cents)" required><UInput v-model.number="form.amountCents" type="number" min="1" max="100000000" step="1" required :disabled="busy" /></UFormField>
            <UFormField label="Paid storage (GB)" required><UInput v-model.number="form.paidStorageGb" type="number" min="1" max="1000000" step="1" required :disabled="busy" /></UFormField>
            <UFormField label="Trial storage (GB)" required><UInput v-model.number="form.trialStorageGb" type="number" min="1" max="1000000" step="1" required :disabled="busy" /></UFormField>
            <UFormField label="Trial days" required><UInput v-model.number="form.trialDays" type="number" min="1" max="90" step="1" required :disabled="busy" /></UFormField>
            <UFormField label="Reason" required><UInput v-model="form.reason" required maxlength="500" :disabled="busy" /></UFormField>
            <UButton type="submit" color="neutral" variant="soft" :loading="busy">Validate and preview</UButton>
            <div v-if="validatedAt" role="status" class="rounded border border-[var(--md-outline-variant)] p-3 text-sm">
                <p>Stripe price validated {{ new Date(validatedAt).toLocaleString() }}: {{ money(form.amountCents) }}/year · {{ form.paidStorageGb }} GB; new trials {{ form.trialDays }} days · {{ form.trialStorageGb }} GB.</p>
                <p>{{ state.impact }}</p><p>Revision {{ state.revision }}. The previous current offer will become grandfathered.</p>
            </div>
            <UButton type="button" :disabled="busy || !validatedAt" @click="change(false)">Confirm new offer</UButton>
        </form>
        <UButton color="neutral" variant="ghost" :disabled="busy" @click="load">Reload offers</UButton>
    </section>
</template>
