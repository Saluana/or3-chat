<template>
    <section aria-labelledby="attention-heading" class="space-y-3 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="attention-heading" class="text-lg font-semibold">Needs attention <UBadge v-if="items.length" color="error" variant="soft">{{ items.length }}</UBadge></h2>
            <span class="text-xs opacity-60">Checked {{ checkedAt ? formatTime(checkedAt) : '…' }} from local records. No Stripe calls or storage scans.</span>
        </div>
        <ul v-if="items.length" class="divide-y divide-[var(--md-outline-variant)]">
            <li v-for="item in items" :key="item.key" class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div class="flex items-center gap-2 font-medium"><UBadge :color="item.priority === 'High' ? 'error' : 'warning'" variant="soft" size="sm">{{ item.priority }}</UBadge>{{ item.title }}</div>
                    <div class="text-sm opacity-70">{{ item.detail }}</div>
                </div>
                <UButton :to="item.to" size="sm" class="shrink-0">{{ item.action }}</UButton>
            </li>
        </ul>
        <p v-else-if="checkedAt && !unavailable.length" class="text-sm opacity-70">Nothing needs attention in the supported checks.</p>
        <p v-if="unavailable.length" class="text-xs opacity-70">Not checked: {{ unavailable.join(', ') }}. Backup verification is not reported by this application; follow the documented operator checks.</p>
    </section>
</template>

<script setup lang="ts">
import { formatTime } from '~/utils/admin/customer-display';

interface Item { key: string; priority: 'High' | 'Medium'; title: string; detail: string; to: string; action: string }
const billingEnabled = useRuntimeConfig().public.hostedBillingEnabled === true;
const items = ref<Item[]>([]);
const unavailable = ref<string[]>([]);
const checkedAt = ref<number | null>(null);

async function load() {
    const next: Item[] = [];
    const missing: string[] = [];
    const [pauses, activity, health, storage] = await Promise.allSettled([
        $fetch<{ available: boolean; pauses: Array<{ kind: string; active: boolean; startedAt: number }> }>('/api/admin/system/pauses', { credentials: 'include' }),
        $fetch<{ items: Array<{ outcome: string; at: number }> }>('/api/admin/activity', { credentials: 'include', query: { limit: 100 } }),
        billingEnabled ? $fetch<{ openReviewAccounts: number; failedOutcomes: number; reviews: Array<{ openedAt: number }> }>('/api/admin/hosted-billing/health', { credentials: 'include' }) : Promise.resolve(null),
        billingEnabled ? $fetch<{ largest: Array<{ chargedBytes: number; access: { nominalStorageLimitBytes: number } }> }>('/api/admin/hosted-billing/storage', { credentials: 'include' }) : Promise.resolve(null),
    ]);
    if (pauses.status === 'fulfilled') {
        if (!pauses.value.available) next.push({ key: 'pause-policy', priority: 'High', title: 'Pause policy unreadable', detail: 'New uploads, jobs, registrations and purchases are refused until it is replaced.', to: '/admin/advanced#pauses', action: 'Open pauses' });
        for (const pause of pauses.value.pauses.filter(item => item.active)) {
            next.push({ key: `pause-${pause.kind}`, priority: 'Medium', title: `New ${pause.kind} paused`, detail: `Since ${formatTime(pause.startedAt)}.`, to: '/admin/advanced#pauses', action: 'Review pause' });
        }
    } else missing.push('service pauses');
    if (activity.status === 'fulfilled') {
        const incomplete = activity.value.items.filter(item => item.outcome === 'incomplete');
        if (incomplete.length) next.push({ key: 'incomplete', priority: 'High', title: 'Incomplete administrative operations', detail: `${incomplete.length} operation(s) among the latest 100 started without a recorded result.`, to: '/admin/activity', action: 'View activity' });
    } else missing.push('administration journal');
    if (health.status === 'fulfilled' && health.value) {
        if (health.value.openReviewAccounts) next.push({ key: 'reviews', priority: 'High', title: 'Payment review holds', detail: `${health.value.openReviewAccounts} account(s) are blocked pending a review decision.`, to: '/admin/customers?filter=attention', action: 'Review accounts' });
        if (health.value.failedOutcomes) next.push({ key: 'processing', priority: 'High', title: 'Failed billing processing', detail: `${health.value.failedOutcomes} webhook or refresh failure(s) in the last 30 days.`, to: '/admin/extensions/hosted-billing', action: 'View failures' });
    } else if (billingEnabled) missing.push('billing health');
    if (storage.status === 'fulfilled' && storage.value) {
        const near = storage.value.largest.filter(row => row.access.nominalStorageLimitBytes && row.chargedBytes >= row.access.nominalStorageLimitBytes * 0.85);
        if (near.length) next.push({ key: 'quota', priority: 'Medium', title: 'Accounts near or over their allowance', detail: `${near.length} of the 50 largest accounts are at 85% or more.`, to: '/admin/storage', action: 'View storage' });
    } else if (billingEnabled) missing.push('storage accounting');
    items.value = next;
    unavailable.value = missing;
    checkedAt.value = Date.now();
}
onMounted(load);
</script>
