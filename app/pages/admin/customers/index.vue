<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-semibold">Customers</h1>
            <p class="text-sm opacity-70">Find an account and see its access, payment and storage situation.</p>
        </div>

        <div v-if="billingEnabled" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div v-for="card in cards" :key="card.label" class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4">
                <div class="text-sm opacity-70">{{ card.label }}</div>
                <div class="text-2xl font-semibold">{{ card.value ?? '—' }}</div>
            </div>
            <p class="col-span-full text-xs opacity-60">Counts cover accounts with a Cloud billing record. People who never started Cloud are listed under All.</p>
        </div>

        <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
            <UInput
                v-model="search"
                type="search"
                aria-label="Search customers"
                placeholder="Search by email, name or account ID"
                :icon="searchIcon"
                :maxlength="200"
                class="flex-1"
                :disabled="filter !== 'all'"
            />
            <div class="flex flex-wrap gap-2" role="group" aria-label="Customer filter">
                <UButton
                    v-for="option in filterOptions"
                    :key="option.value"
                    :variant="filter === option.value ? 'solid' : 'soft'"
                    :color="filter === option.value ? 'primary' : 'neutral'"
                    :aria-pressed="filter === option.value"
                    @click="setFilter(option.value)"
                >
                    {{ option.label }}
                </UButton>
            </div>
        </div>
        <p v-if="filter !== 'all'" class="text-xs opacity-60">Filters apply to every matching account on the server. Search applies to All.</p>

        <UAlert v-if="error" color="error" title="Customers could not be loaded" :description="error">
            <template #actions><UButton color="neutral" variant="soft" @click="load()">Try again</UButton></template>
        </UAlert>
        <UAlert v-else-if="unavailable" color="warning" title="Customer directory unavailable" description="The configured sync provider does not support customer inspection. Use Workspaces to find accounts." />
        <UAlert v-if="missingCanonical" color="warning" :title="`${missingCanonical} billing record(s) on this page have no canonical account`" description="They are not shown. Check the sync provider before acting on them." />

        <div v-if="pending && !rows.length" class="space-y-3" role="status" aria-label="Loading customers">
            <div v-for="i in 5" :key="i" class="h-16 animate-pulse rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-highest)]" />
        </div>

        <div v-else-if="rows.length" class="overflow-x-auto rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)]">
            <table class="w-full min-w-[760px] text-sm">
                <thead class="bg-[var(--md-surface-container-low)] text-left">
                    <tr>
                        <th scope="col" class="p-3 font-medium">Customer</th>
                        <th v-if="billingEnabled" scope="col" class="p-3 font-medium">Cloud access</th>
                        <th v-if="billingEnabled" scope="col" class="p-3 font-medium">Plan</th>
                        <th v-if="billingEnabled" scope="col" class="p-3 font-medium">Storage</th>
                        <th scope="col" class="p-3 font-medium">Last server contact</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.userId" class="border-t border-[var(--md-outline-variant)]">
                        <td class="p-3 align-top">
                            <NuxtLink :to="`/admin/customers/${encodeURIComponent(row.userId)}`" class="font-medium underline-offset-2 hover:underline focus-visible:underline">
                                {{ row.email || row.userId }}
                            </NuxtLink>
                            <div v-if="row.displayName" class="text-xs opacity-70">{{ row.displayName }}</div>
                            <div class="font-mono text-xs opacity-60 break-all">{{ row.userId }}</div>
                        </td>
                        <td v-if="billingEnabled" class="p-3 align-top">
                            <template v-if="row.billing">
                                <UBadge :color="row.billing.access.allowed ? 'success' : row.billing.access.blockers.includes('review_required') ? 'warning' : 'neutral'" variant="soft">
                                    {{ row.billing.access.allowed ? 'Allowed' : blockerLabels[row.billing.access.blockers[0] ?? ''] ?? 'Blocked' }}
                                </UBadge>
                            </template>
                            <span v-else class="opacity-60">Unknown</span>
                        </td>
                        <td v-if="billingEnabled" class="p-3 align-top">
                            <template v-if="row.billing">
                                <div>{{ row.billing.state === 'cloud_not_started' ? 'Cloud not started' : sourceLabels[row.billing.access.source] }}</div>
                                <div v-if="row.billing.access.expiresAt" class="text-xs opacity-70">Until {{ formatTime(row.billing.access.expiresAt) }}</div>
                            </template>
                        </td>
                        <td v-if="billingEnabled" class="p-3 align-top">
                            <template v-if="row.billing && row.billing.state !== 'cloud_not_started'">
                                {{ formatBytes(row.billing.storageUsedBytes) }} of {{ formatBytes(row.billing.access.nominalStorageLimitBytes) }}
                                <div v-if="row.billing.storageUsedBytes === null" class="text-xs opacity-70">Accounting unavailable</div>
                            </template>
                            <span v-else class="opacity-60">—</span>
                        </td>
                        <td class="p-3 align-top">
                            {{ row.lastContactAt ? formatTime(row.lastContactAt) : 'Not observed' }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div v-else-if="!error && !unavailable" class="py-12 text-center">
            <p class="text-lg font-medium opacity-70">No customers found</p>
            <p class="text-sm opacity-50">Try another search or filter.</p>
        </div>

        <div v-if="rows.length" class="flex items-center justify-between gap-3">
            <span class="text-sm opacity-70" role="status">{{ rows.length }} shown on this page</span>
            <div class="flex gap-2">
                <UButton variant="soft" color="neutral" :disabled="!cursors.length || pending" @click="previous">Previous</UButton>
                <UButton variant="soft" color="neutral" :disabled="!nextCursor || pending" @click="next">Next</UButton>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core';
import { blockerLabels, formatBytes, formatTime, sourceLabels } from '~/utils/admin/customer-display';

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });

type Filter = 'all' | 'attention' | 'trial' | 'paid';
interface BillingSummary {
    state: string;
    access: { allowed: boolean; source: string; blockers: string[]; expiresAt: number | null; nominalStorageLimitBytes: number };
    storageUsedBytes: number | null;
}
interface Row { userId: string; email?: string; displayName?: string; lastContactAt: number | null; billing?: BillingSummary }

const billingEnabled = useRuntimeConfig().public.hostedBillingEnabled === true;
const searchIcon = useIcon('ui.search');
const route = useRoute();
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
const debounced = refDebounced(search, 300);
const filter = ref<Filter>(['attention', 'trial', 'paid'].includes(String(route.query.filter)) && billingEnabled ? route.query.filter as Filter : 'all');
const rows = ref<Row[]>([]);
const pending = ref(false);
const error = ref('');
const unavailable = ref(false);
const missingCanonical = ref(0);
const nextCursor = ref<string | null>(null);
const cursors = ref<Array<string | null>>([]);
const cursor = ref<string | null>(null);
const counts = ref<Record<string, number> | null>(null);
const filterOptions = computed(() => [
    { label: 'All', value: 'all' as const },
    ...(billingEnabled ? [
        { label: 'Needs attention', value: 'attention' as const },
        { label: 'Trial', value: 'trial' as const },
        { label: 'Paid', value: 'paid' as const },
    ] : []),
]);
const cards = computed(() => [
    { label: 'Cloud accounts', value: counts.value?.accounts },
    { label: 'Needs attention', value: counts.value?.attention },
    { label: 'Trial', value: counts.value?.trial },
    { label: 'Paid', value: counts.value?.paid },
]);
const { getMessage } = useApiError();
let request = 0;

async function load() {
    const id = ++request;
    pending.value = true;
    error.value = '';
    try {
        if (filter.value === 'all') {
            const page = await $fetch<{ available: boolean; items: Row[]; nextCursor: string | null }>('/api/admin/customers', {
                credentials: 'include', query: { q: debounced.value.trim() || undefined, cursor: cursor.value ?? undefined },
            });
            let items = page.items;
            if (billingEnabled && items.length) {
                try {
                    const billing = await $fetch<{ items: Array<BillingSummary & { userId: string }> }>('/api/admin/hosted-billing/accounts', {
                        credentials: 'include', query: { ids: items.map(item => item.userId).join(',') },
                    });
                    const byId = new Map(billing.items.map(item => [item.userId, item]));
                    items = items.map(item => ({ ...item, billing: byId.get(item.userId) }));
                } catch { /* Canonical rows remain; billing columns show Unknown. */ }
            }
            if (id !== request) return;
            unavailable.value = !page.available;
            missingCanonical.value = 0;
            rows.value = items;
            nextCursor.value = page.nextCursor;
        } else {
            const page = await $fetch<{ available: boolean; items: Row[]; nextCursor: string | null; missingCanonical: number; counts: Record<string, number> }>('/api/admin/hosted-billing/accounts', {
                credentials: 'include', query: { filter: filter.value, cursor: cursor.value ?? undefined },
            });
            if (id !== request) return;
            unavailable.value = !page.available;
            missingCanonical.value = page.missingCanonical;
            rows.value = page.items;
            nextCursor.value = page.nextCursor;
            counts.value = page.counts;
        }
    } catch (err) {
        if (id !== request) return;
        rows.value = [];
        error.value = getMessage(err) || 'Try again.';
    } finally {
        if (id === request) pending.value = false;
    }
}

async function loadCounts() {
    if (!billingEnabled) return;
    try { counts.value = (await $fetch<{ counts: Record<string, number> }>('/api/admin/hosted-billing/accounts', { credentials: 'include', query: { counts: '1' } })).counts; }
    catch { counts.value = null; }
}

function reset() {
    cursor.value = null;
    cursors.value = [];
}
function setFilter(value: Filter) {
    filter.value = value;
    reset();
    void navigateTo({ query: { ...route.query, filter: value === 'all' ? undefined : value } }, { replace: true });
    void load();
}
function next() {
    cursors.value.push(cursor.value);
    cursor.value = nextCursor.value;
    void load();
}
function previous() {
    cursor.value = cursors.value.pop() ?? null;
    void load();
}

watch(debounced, () => { reset(); void load(); });
onMounted(() => { void load(); void loadCounts(); });
</script>
