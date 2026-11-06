<template>
    <div class="space-y-6">
        <div>
            <p class="text-xs font-medium uppercase tracking-wide opacity-60">Operations</p>
            <h1 class="text-2xl font-semibold">Activity</h1>
            <p class="text-sm opacity-70">Who changed access, limits, pauses or configuration, and why.</p>
        </div>

        <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" @submit.prevent="reload">
            <UFormField label="Target ID"><UInput v-model="filters.targetId" :maxlength="200" class="w-full" /></UFormField>
            <UFormField label="Actor"><UInput v-model="filters.actor" :maxlength="200" class="w-full" /></UFormField>
            <UFormField label="Action"><UInput v-model="filters.action" :maxlength="80" placeholder="e.g. pause.uploads" class="w-full" /></UFormField>
            <UFormField label="Since"><UInput v-model="filters.since" type="date" class="w-full" /></UFormField>
            <div class="flex items-end"><UButton type="submit" color="neutral" variant="soft" :loading="pending">Apply filters</UButton></div>
        </form>

        <UAlert v-for="source in failedSources" :key="source" color="error" :title="`${sourceLabels[source]} history unavailable`" description="Other sources are still shown." />
        <ul class="space-y-1 text-xs opacity-70">
            <li v-for="source in activeSources" :key="source">
                {{ sourceLabels[source] }}: {{ coverage[source] ? `recorded since ${formatTime(coverage[source]!)}` : 'no records yet' }}{{ truncated[source] ? ' · older records beyond the scan window are not shown' : '' }}
            </li>
        </ul>

        <div class="overflow-x-auto rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)]">
            <table class="w-full min-w-[720px] text-sm">
                <thead class="bg-[var(--md-surface-container-low)] text-left">
                    <tr>
                        <th scope="col" class="p-3 font-medium">Time</th>
                        <th scope="col" class="p-3 font-medium">Action</th>
                        <th scope="col" class="p-3 font-medium">Target</th>
                        <th scope="col" class="p-3 font-medium">Actor</th>
                        <th scope="col" class="p-3 font-medium">Reason</th>
                        <th scope="col" class="p-3 font-medium">Outcome</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" :key="`${item.source}:${item.operationId}`" class="border-t border-[var(--md-outline-variant)] align-top">
                        <td class="p-3 whitespace-nowrap">{{ formatTime(item.at) }}</td>
                        <td class="p-3">{{ actionLabels[item.action] ?? item.action }}<div class="text-xs opacity-60">{{ sourceLabels[item.source] }}</div></td>
                        <td class="p-3">
                            <NuxtLink v-if="item.target.kind === 'account'" :to="`/admin/customers/${encodeURIComponent(item.target.id)}`" class="font-mono text-xs underline-offset-2 hover:underline">{{ item.target.id }}</NuxtLink>
                            <span v-else class="font-mono text-xs">{{ item.target.kind }}: {{ item.target.id }}</span>
                        </td>
                        <td class="p-3">{{ item.actor }}</td>
                        <td class="p-3">{{ item.reason || '—' }}</td>
                        <td class="p-3">
                            <UBadge :color="item.outcome === 'completed' ? 'success' : item.outcome === 'failed' ? 'error' : 'warning'" variant="soft">{{ item.outcome }}</UBadge>
                            <div v-if="item.outcome === 'incomplete'" class="mt-1 text-xs opacity-70">Started but no result was recorded. Check the current state before retrying.</div>
                        </td>
                    </tr>
                    <tr v-if="!items.length && !pending"><td colspan="6" class="p-3 opacity-70">No matching activity.</td></tr>
                </tbody>
            </table>
        </div>
        <div class="flex justify-end">
            <UButton color="neutral" variant="soft" :disabled="!hasMore || pending" :loading="pending" @click="loadMore">Load older</UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { actionLabels as accountActionLabels, formatTime } from '~/utils/admin/customer-display';

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });

type Source = 'admin' | 'billing';
interface Item { operationId: string; source: Source; at: number; actor: string; action: string; target: { kind: string; id: string }; reason: string | null; outcome: string }
interface Page { items: Item[]; nextCursor: string | null; coverageStart: number | null; truncated?: boolean }

const billingEnabled = useRuntimeConfig().public.hostedBillingEnabled === true;
const activeSources: Source[] = billingEnabled ? ['admin', 'billing'] : ['admin'];
const endpoints: Record<Source, string> = { admin: '/api/admin/activity', billing: '/api/admin/hosted-billing/activity' };
const sourceLabels: Record<Source, string> = { admin: 'Administration journal', billing: 'Billing decisions' };
const actionLabels: Record<string, string> = {
    ...accountActionLabels,
    'pause.uploads': 'Uploads pause changed', 'pause.jobs': 'Background jobs pause changed',
    'pause.registrations': 'Registrations pause changed', 'pause.purchases': 'Purchases pause changed',
};
const route = useRoute();
const filters = reactive({ targetId: typeof route.query.targetId === 'string' ? route.query.targetId : '', actor: '', action: '', since: '' });
const items = ref<Item[]>([]);
const cursors = reactive<Record<Source, string | null | undefined>>({ admin: undefined, billing: undefined });
const coverage = reactive<Record<Source, number | null>>({ admin: null, billing: null });
const truncated = reactive<Record<Source, boolean>>({ admin: false, billing: false });
const failedSources = ref<Source[]>([]);
const pending = ref(false);
const hasMore = computed(() => activeSources.some(source => cursors[source] !== null && !failedSources.value.includes(source)));

async function fetchSource(source: Source): Promise<Item[]> {
    if (cursors[source] === null) return [];
    try {
        const page = await $fetch<Page>(endpoints[source], {
            credentials: 'include',
            query: {
                limit: 25, cursor: cursors[source] || undefined, targetId: filters.targetId.trim() || undefined,
                actor: filters.actor.trim() || undefined, action: filters.action.trim() || undefined,
                since: filters.since ? new Date(filters.since).getTime() : undefined,
            },
        });
        cursors[source] = page.nextCursor;
        coverage[source] = page.coverageStart;
        truncated[source] = page.truncated === true;
        return page.items.map(item => ({ ...item, source }));
    } catch {
        failedSources.value.push(source);
        cursors[source] = null;
        return [];
    }
}

async function loadMore() {
    pending.value = true;
    try {
        const pages = await Promise.all(activeSources.map(fetchSource));
        items.value = [...items.value, ...pages.flat()].sort((a, b) => b.at - a.at || (a.operationId < b.operationId ? 1 : -1));
    } finally { pending.value = false; }
}

function reload() {
    items.value = [];
    failedSources.value = [];
    for (const source of activeSources) cursors[source] = undefined;
    void loadMore();
}
onMounted(reload);
</script>
