<template>
    <section class="flex h-full min-h-0 flex-col" aria-label="Activity runs">
        <header class="shrink-0 space-y-2 border-b border-[var(--md-outline-variant)] px-3 py-3">
            <div class="flex items-center justify-between gap-2">
                <div>
                    <h2 class="text-sm font-semibold text-[var(--md-on-surface)]">
                        Activity
                    </h2>
                    <p class="text-xs text-[var(--md-on-surface-variant)]">
                        Ongoing and recent work
                    </p>
                </div>
                <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="lucide:refresh-cw"
                    aria-label="Refresh activity"
                    :loading="loading"
                    @click="load"
                />
            </div>
            <div class="flex gap-1 overflow-x-auto pb-1" aria-label="Activity filters">
                <UButton
                    v-for="option in filterOptions"
                    :key="option.id"
                    size="xs"
                    :color="filter === option.id ? 'primary' : 'neutral'"
                    :variant="filter === option.id ? 'soft' : 'ghost'"
                    :aria-pressed="filter === option.id"
                    @click="selectFilter(option.id)"
                >
                    {{ option.label }}
                </UButton>
            </div>
        </header>

        <div v-if="degradedSources.length" class="shrink-0 px-3 pt-3">
            <UAlert
                color="warning"
                variant="soft"
                title="Some activity is unavailable"
                :description="degradedDescription"
            />
        </div>

        <div
            v-if="loading && !runs.length"
            class="flex-1 space-y-3 overflow-hidden px-3 py-4"
            aria-label="Loading activity"
        >
            <USkeleton v-for="index in 5" :key="index" class="h-20 w-full" />
        </div>

        <div
            v-else-if="!registry.listSources().length"
            class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
        >
            <UIcon name="lucide:unplug" class="size-8 text-[var(--md-outline)]" />
            <p class="text-sm font-medium">Activity sources disconnected</p>
            <p class="text-xs text-[var(--md-on-surface-variant)]">
                Enable workflows or background processing to see activity.
            </p>
        </div>

        <div
            v-else-if="!runs.length"
            class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
        >
            <UIcon name="lucide:activity" class="size-8 text-[var(--md-outline)]" />
            <p class="text-sm font-medium">No {{ filterLabel.toLowerCase() }} activity</p>
            <p class="text-xs text-[var(--md-on-surface-variant)]">
                New work will appear here automatically.
            </p>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <button
                v-for="run in runs"
                :key="`${run.sourceId}:${run.id}`"
                type="button"
                :class="[
                    'mb-1 w-full rounded-[var(--md-border-radius)] border px-2 py-2 text-left transition hover:border-[var(--md-outline-variant)] hover:bg-[var(--md-surface-variant)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]',
                    selectedRecordId === runRecordId(run)
                        ? 'border-[var(--md-primary)] bg-[var(--md-surface-variant)]'
                        : 'border-transparent',
                ]"
                :aria-pressed="selectedRecordId === runRecordId(run)"
                @click="openRun(run.sourceId, run.id)"
            >
                <div class="flex items-start justify-between gap-2">
                    <span class="line-clamp-2 text-sm font-medium text-[var(--md-on-surface)]">
                        {{ run.title }}
                    </span>
                    <UBadge
                        size="xs"
                        :color="statusColor(run.status)"
                        variant="soft"
                    >
                        {{ statusLabel(run.status) }}
                    </UBadge>
                </div>
                <p v-if="run.summary" class="mt-1 line-clamp-2 text-xs text-[var(--md-on-surface-variant)]">
                    {{ run.summary }}
                </p>
                <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--md-outline)]">
                    <span>{{ sourceLabel(run.sourceId) }} · {{ run.kind }}</span>
                    <time :datetime="run.updatedAt">
                        {{ relativeTime(run.updatedAt) }}
                        <template v-if="run.status === 'running'">
                            · {{ elapsed(run.startedAt) }}
                        </template>
                    </time>
                </div>
            </button>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
    getActivityRegistry,
    type ActivitySubscription,
} from '~/core/activity/registry';
import type {
    ActivityRunStatus,
    ActivityRunSummary,
} from '~/core/activity/contract';
import {
    encodeActivityRunRef,
} from '~/core/activity/run-ref';
import { getKvByName, setKvByName } from '~/db/kv';

defineOptions({ name: 'or3-activity-run-list' });

defineProps<{
    selectedRecordId?: string | null;
}>();

const emit = defineEmits<{
    select: [recordId: string];
}>();

type ActivityFilter =
    | 'running'
    | 'approvals'
    | 'failed'
    | 'completed';

const FILTER_KV_KEY = 'activity.center.filter';
const filterOptions: Array<{ id: ActivityFilter; label: string }> = [
    { id: 'running', label: 'Running' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'failed', label: 'Failed' },
    { id: 'completed', label: 'Completed' },
];
const registry = getActivityRegistry();
const filter = ref<ActivityFilter>('running');
const runs = ref<ActivityRunSummary[]>([]);
const degradedSources = ref<
    Awaited<ReturnType<typeof registry.listRuns>>['degradedSources']
>([]);
const loading = ref(true);
let subscription: ActivitySubscription | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

const filterLabel = computed(
    () =>
        filterOptions.find((option) => option.id === filter.value)?.label ??
        'Current'
);
const degradedDescription = computed(() =>
    degradedSources.value
        .map((error) => registry.get(error.sourceId ?? '')?.label ?? error.sourceId)
        .filter(Boolean)
        .join(', ')
);

function statusesForFilter(value: ActivityFilter): ActivityRunStatus[] {
    if (value === 'running') return ['queued', 'running'];
    if (value === 'approvals') return ['waiting_approval'];
    if (value === 'failed') return ['failed'];
    return ['succeeded', 'cancelled'];
}

async function load() {
    loading.value = true;
    const result = await registry.listRuns({
        statuses: statusesForFilter(filter.value),
        limit: 100,
    });
    runs.value = [...result.runs];
    degradedSources.value = result.degradedSources;
    loading.value = false;
}

function scheduleLoad() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(), 120);
}

async function selectFilter(value: ActivityFilter) {
    if (filter.value === value) return;
    filter.value = value;
    await setKvByName(FILTER_KV_KEY, value).catch(() => undefined);
    await load();
}

function openRun(sourceId: string, runId: string) {
    emit('select', encodeActivityRunRef({ sourceId, runId }));
}

function runRecordId(run: ActivityRunSummary): string {
    return encodeActivityRunRef({
        sourceId: run.sourceId,
        runId: run.id,
    });
}

function sourceLabel(sourceId: string): string {
    return registry.get(sourceId)?.label ?? sourceId;
}

function statusLabel(status: ActivityRunStatus): string {
    return status.replace('_', ' ');
}

function statusColor(status: ActivityRunStatus) {
    if (status === 'failed') return 'error';
    if (status === 'waiting_approval') return 'warning';
    if (status === 'succeeded') return 'success';
    return 'neutral';
}

function relativeTime(value: string): string {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    if (seconds < 60) return 'now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86_400)}d`;
}

function elapsed(value: string): string {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

onMounted(async () => {
    const saved = await getKvByName(FILTER_KV_KEY).catch(() => undefined);
    if (
        saved?.value &&
        filterOptions.some((option) => option.id === saved.value)
    ) {
        filter.value = saved.value as ActivityFilter;
    }
    await load();
    subscription = registry.subscribe({
        onEvent: scheduleLoad,
        onError: scheduleLoad,
    });
});

onBeforeUnmount(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
    subscription?.dispose();
});
</script>
