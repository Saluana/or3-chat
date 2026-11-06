<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { UAlert, UBadge, UButton } from '#components';
import { $fetch } from 'ofetch';

interface Health {
    environment: 'live' | 'test';
    offer: { amount: number; currency: string; interval: string; trialDays: number; paidStorageGb: number; trialStorageGb: number };
    priceCheck: null | { checkedAt: number; result: string; code: string | null };
    reconciliation: { lastAt: number | null; failedAccounts: number };
    counts: { paid: number; trial: number; attention: number; accounts: number };
    reviews: Array<{ id: string; userId: string; kind: string; openedAt: number; subscriptionStatus: string; paidUntil: number }>;
    openReviewAccounts: number;
    outcomes: Array<{ id: string; kind: string; userId: string | null; attempts: number; lastAttemptAt: number; result: string; code: string | null }>;
    failedOutcomes: number;
    outcomeWindowDays: number;
}
const props = defineProps<{ view: 'overview' | 'reviews' | 'processing' }>();
const health = ref<Health | null>(null);
const error = ref('');
const checking = ref(false);
const reviewLabels: Record<string, string> = {
    refund: 'Refund issued', dispute: 'Payment dispute', fraud_warning: 'Early fraud warning',
    conflicting_subscriptions: 'Conflicting subscriptions', legacy: 'Legacy review — reason unavailable',
};
const time = (value: number | null | undefined) => value ? new Date(value).toLocaleString() : '—';
const failures = computed(() => health.value?.outcomes.filter(outcome => outcome.result === 'failed') ?? []);
async function load(method: 'GET' | 'POST' = 'GET') {
    error.value = '';
    try {
        health.value = await $fetch<Health>('/api/admin/hosted-billing/health', { method, retry: 0, ...(method === 'POST' ? { headers: { 'x-or3-admin-intent': 'admin' } } : {}) });
    } catch { error.value = 'Billing health is unavailable. Global administrator access is required.'; }
}
async function checkPrice() {
    checking.value = true;
    try { await load('POST'); } finally { checking.value = false; }
}
onMounted(() => load());
</script>

<template>
    <div class="space-y-4">
        <UAlert v-if="error" color="error" title="Billing health unavailable" :description="error" />
        <template v-if="health && props.view === 'overview'">
            <div class="grid gap-3 md:grid-cols-3">
                <div class="tile">
                    <div class="font-semibold">Stripe integration <UBadge :color="health.environment === 'live' ? 'success' : 'warning'" variant="soft">{{ health.environment === 'live' ? 'Live' : 'Test mode' }}</UBadge></div>
                    <p class="text-sm">Price check: <strong>{{ health.priceCheck ? health.priceCheck.result : 'never run' }}</strong></p>
                    <p class="text-xs text-muted">{{ health.priceCheck ? `Checked ${time(health.priceCheck.checkedAt)}` : 'Opening this page does not contact Stripe.' }}</p>
                    <UButton class="mt-2" size="sm" color="neutral" variant="soft" :loading="checking" @click="checkPrice">Check price in Stripe</UButton>
                </div>
                <div class="tile">
                    <div class="font-semibold">Offer</div>
                    <p class="text-lg font-semibold">${{ health.offer.amount }} {{ health.offer.currency }} / {{ health.offer.interval }}</p>
                    <p class="text-sm">{{ health.offer.paidStorageGb }} GB per account · {{ health.offer.trialDays }}-day trial with {{ health.offer.trialStorageGb }} GB</p>
                    <p class="text-xs text-muted">The price is fixed by configuration and validated before Checkout.</p>
                </div>
                <div class="tile">
                    <div class="font-semibold">Latest reconciliation</div>
                    <p class="text-sm">{{ time(health.reconciliation.lastAt) }}</p>
                    <p class="text-sm">Accounts whose last refresh failed: {{ health.reconciliation.failedAccounts }}</p>
                    <p class="text-xs text-muted">Refreshes run per account from webhooks, checkout and support. There is no global sweep.</p>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div class="tile"><div class="text-sm text-muted">Paid</div><div class="text-2xl font-semibold">{{ health.counts.paid }}</div></div>
                <div class="tile"><div class="text-sm text-muted">Trials</div><div class="text-2xl font-semibold">{{ health.counts.trial }}</div></div>
                <div class="tile"><div class="text-sm text-muted">On review hold</div><div class="text-2xl font-semibold">{{ health.openReviewAccounts }}</div></div>
                <div class="tile"><div class="text-sm text-muted">Failed processing ({{ health.outcomeWindowDays }} days)</div><div class="text-2xl font-semibold">{{ health.failedOutcomes }}</div></div>
            </div>
            <p class="text-xs text-muted">A review hold blocks hosted access for an account. It is separate from the Stripe payment state, which can still be active, past due or canceled.</p>
        </template>

        <template v-if="health && props.view === 'reviews'">
            <div class="overflow-x-auto rounded border border-[var(--md-outline-variant)]">
                <table class="w-full min-w-[620px] text-sm">
                    <thead class="text-left"><tr><th scope="col" class="p-2">Account</th><th scope="col" class="p-2">Review reason</th><th scope="col" class="p-2">Opened</th><th scope="col" class="p-2">Stripe status</th><th scope="col" class="p-2"><span class="sr-only">Action</span></th></tr></thead>
                    <tbody>
                        <tr v-for="review in health.reviews" :key="review.id" class="border-t border-[var(--md-outline-variant)]">
                            <td class="p-2 font-mono text-xs">{{ review.userId }}</td>
                            <td class="p-2">{{ reviewLabels[review.kind] ?? review.kind }}</td>
                            <td class="p-2">{{ time(review.openedAt) }}</td>
                            <td class="p-2">{{ review.subscriptionStatus || 'none' }}</td>
                            <td class="p-2"><UButton size="sm" :to="`/admin/customers/${encodeURIComponent(review.userId)}`">Review</UButton></td>
                        </tr>
                        <tr v-if="!health.reviews.length"><td colspan="5" class="p-2 text-muted">No open reviews.</td></tr>
                    </tbody>
                </table>
            </div>
            <p v-if="health.openReviewAccounts > health.reviews.length" class="text-xs text-muted">{{ health.openReviewAccounts }} accounts are on hold; the oldest 50 recorded reviews are listed. Holds set outside the module appear on the account page as legacy reviews.</p>
        </template>

        <template v-if="health && props.view === 'processing'">
            <p class="text-sm">Webhook and refresh outcomes from the last {{ health.outcomeWindowDays }} days. A failed handler leaves the event retryable by Stripe; a successful <code>invoice.payment_failed</code> is a customer payment failure, not a processing failure.</p>
            <UAlert v-if="failures.length" color="warning" :title="`${failures.length} recent processing failure(s)`" description="Open the account and use Refresh from Stripe, or wait for Stripe to retry." />
            <div class="overflow-x-auto rounded border border-[var(--md-outline-variant)]">
                <table class="w-full min-w-[620px] text-sm">
                    <thead class="text-left"><tr><th scope="col" class="p-2">Last attempt</th><th scope="col" class="p-2">Event</th><th scope="col" class="p-2">Account</th><th scope="col" class="p-2">Result</th><th scope="col" class="p-2">Attempts</th></tr></thead>
                    <tbody>
                        <tr v-for="outcome in health.outcomes" :key="outcome.id" class="border-t border-[var(--md-outline-variant)]">
                            <td class="p-2">{{ time(outcome.lastAttemptAt) }}</td>
                            <td class="p-2">{{ outcome.kind }}<div class="font-mono text-xs text-muted">{{ outcome.id }}</div></td>
                            <td class="p-2"><a v-if="outcome.userId" :href="`/admin/customers/${encodeURIComponent(outcome.userId)}`" class="font-mono text-xs underline">{{ outcome.userId }}</a><span v-else class="text-muted">Unmatched</span></td>
                            <td class="p-2"><UBadge :color="outcome.result === 'failed' ? 'error' : outcome.result === 'succeeded' ? 'success' : 'neutral'" variant="soft">{{ outcome.result }}</UBadge><div v-if="outcome.code" class="text-xs text-muted">{{ outcome.code }}</div></td>
                            <td class="p-2">{{ outcome.attempts }}</td>
                        </tr>
                        <tr v-if="!health.outcomes.length"><td colspan="5" class="p-2 text-muted">No recorded outcomes yet.</td></tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<style scoped>
.tile { border: 1px solid var(--md-outline-variant); border-radius: var(--md-border-radius); padding: 1rem; }
</style>
