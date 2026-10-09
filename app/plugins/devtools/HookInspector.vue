<template>
    <div class="space-y-4 p-4 sm:p-6">
        <!-- Header -->
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-[12rem] flex-1">
                <h2 class="text-lg font-semibold flex items-center gap-2 whitespace-nowrap">
                    <UIcon :name="useIcon('ui.sync').value" class="w-5 h-5" />
                    Hook Inspector
                </h2>
                <p class="text-sm opacity-70 mt-1">
                    Monitor hook performance, execution counts, and errors
                </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                <UButton
                    size="sm"
                    variant="outline"
                    class="whitespace-nowrap"
                    :icon="useIcon('ui.refresh').value"
                    :disabled="autoRefresh"
                    @click="refresh"
                >
                    Refresh
                </UButton>
                <UButton
                    size="sm"
                    class="whitespace-nowrap"
                    :variant="autoRefresh ? 'solid' : 'outline'"
                    :icon="
                        autoRefresh
                            ? useIcon('ui.checkbox.on').value
                            : useIcon('ui.checkbox.off').value
                    "
                    @click="toggleAutoRefresh"
                >
                    Auto
                </UButton>
                <UButton
                    size="sm"
                    variant="outline"
                    class="whitespace-nowrap"
                    :icon="useIcon('ui.trash').value"
                    color="error"
                    @click="clearTimings"
                >
                    Clear
                </UButton>
            </div>
        </div>

        <!-- Documentation Link -->
        <div
            class="p-3 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
        >
            <div class="flex items-start gap-2">
                <UIcon
                    :name="useIcon('ui.book').value"
                    class="w-4 h-4 mt-0.5 opacity-60"
                />
                <div class="text-sm flex-1">
                    <span class="opacity-80">
                        See the
                        <a
                            href="/documentation/hooks/hook-catalog"
                            target="_blank"
                            class="underline hover:opacity-100"
                        >
                            Hook catalog
                        </a>
                        documentation for a complete list of available hooks and
                        their payloads.
                    </span>
                </div>
            </div>
        </div>

        <!-- Summary Cards -->
        <div class="grid grid-cols-3 gap-2 sm:gap-4">
            <div
                class="min-w-0 p-3 sm:p-4 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1 truncate">Total Actions</div>
                <div class="text-2xl font-bold tracking-tight">
                    {{ stats.totalActions }}
                </div>
            </div>
            <div
                class="min-w-0 p-3 sm:p-4 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1 truncate">Total Filters</div>
                <div class="text-2xl font-bold tracking-tight">
                    {{ stats.totalFilters }}
                </div>
            </div>
            <div
                class="min-w-0 p-3 sm:p-4 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1 truncate">Total Errors</div>
                <div
                    class="text-2xl font-bold tracking-tight"
                    :class="stats.totalErrors > 0 ? 'text-red-500' : ''"
                >
                    {{ stats.totalErrors }}
                </div>
            </div>
        </div>

        <!-- Hook Details Table -->
        <div
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] overflow-hidden"
        >
            <div
                class="bg-[var(--md-surface-container-high)] px-4 py-2 border-b-[length:var(--md-border-width-subtle)] border-[var(--md-outline-variant)]"
            >
                <h3 class="text-sm font-semibold">Hook Details</h3>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full min-w-max text-sm">
                    <thead
                        class="bg-[var(--md-surface-container)] border-b-[length:var(--md-border-width-subtle)] border-[var(--md-outline-variant)]"
                    >
                        <tr>
                            <th
                                class="sticky left-0 bg-[var(--md-surface-container)] px-3 py-2 sm:px-4 whitespace-nowrap text-left font-medium"
                            >
                                <span class="opacity-70">Hook Name</span>
                            </th>
                            <th
                                class="px-3 py-2 sm:px-4 whitespace-nowrap text-right font-medium opacity-70"
                            >
                                Calls
                            </th>
                            <th
                                class="px-3 py-2 sm:px-4 whitespace-nowrap text-right font-medium opacity-70"
                            >
                                Avg (ms)
                            </th>
                            <th
                                class="px-3 py-2 sm:px-4 whitespace-nowrap text-right font-medium opacity-70"
                            >
                                P95 (ms)
                            </th>
                            <th
                                class="px-3 py-2 sm:px-4 whitespace-nowrap text-right font-medium opacity-70"
                            >
                                Max (ms)
                            </th>
                            <th
                                class="px-3 py-2 sm:px-4 whitespace-nowrap text-right font-medium opacity-70"
                            >
                                Errors
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="hook in hookDetails"
                            :key="hook.name"
                            class="border-b-[length:var(--md-border-width-subtle)] border-[var(--md-outline-variant)] hover:bg-[var(--md-surface-container-low)]"
                        >
                            <td class="sticky left-0 bg-[var(--md-surface)] px-3 py-2 sm:px-4 whitespace-nowrap font-mono text-xs">
                                <div class="max-w-[45vw] truncate sm:max-w-none" :title="hook.name">
                                    {{ hook.name }}
                                </div>
                            </td>
                            <td class="px-3 py-2 sm:px-4 whitespace-nowrap text-right tabular-nums">
                                {{ hook.count }}
                            </td>
                            <td class="px-3 py-2 sm:px-4 whitespace-nowrap text-right tabular-nums">
                                {{ hook.avg }}
                            </td>
                            <td class="px-3 py-2 sm:px-4 whitespace-nowrap text-right tabular-nums">
                                {{ hook.p95 }}
                            </td>
                            <td class="px-3 py-2 sm:px-4 whitespace-nowrap text-right tabular-nums">
                                {{ hook.max }}
                            </td>
                            <td
                                class="px-3 py-2 sm:px-4 whitespace-nowrap text-right tabular-nums"
                                :class="hook.errors > 0 ? 'text-red-500' : ''"
                            >
                                {{ hook.errors }}
                            </td>
                        </tr>
                        <tr v-if="hookDetails.length === 0">
                            <td
                                colspan="6"
                                class="px-4 py-8 text-center opacity-50"
                            >
                                No hooks have been executed yet. Interact with
                                the app to see hook activity.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue';
import { useIcon } from '~/composables/useIcon';
import {
    readHookInspectorSnapshot,
    resetHookInspectorDiagnostics,
    type HookInspectorSnapshot,
} from '~/core/hooks/hook-inspector-snapshot';

const hooks = useHooks();
const toast = useToast();

// State - use reactive copies of the diagnostics data
const autoRefresh = ref(false);
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// Reactive snapshot of diagnostics
const diagnosticsSnapshot = reactive({
    timings: {} as Record<string, number[]>,
    timingStats: {} as Record<
        string,
        { count: number; total: number; max: number }
    >,
    errors: {} as Record<string, number>,
    totalActions: 0,
    totalFilters: 0,
});

// Update snapshot from hooks engine
function updateSnapshot(
    snapshot: HookInspectorSnapshot = readHookInspectorSnapshot(hooks._engine),
) {
    diagnosticsSnapshot.timings = {};
    for (const [key, value] of Object.entries(snapshot.timings)) {
        diagnosticsSnapshot.timings[key] = [...value];
    }
    diagnosticsSnapshot.timingStats = { ...snapshot.timingStats };
    diagnosticsSnapshot.errors = { ...snapshot.errors };
    diagnosticsSnapshot.totalActions = snapshot.totalActions;
    diagnosticsSnapshot.totalFilters = snapshot.totalFilters;
}

// Toggle auto-refresh
function toggleAutoRefresh() {
    autoRefresh.value = !autoRefresh.value;
    if (autoRefresh.value) {
        refreshInterval = setInterval(() => {
            updateSnapshot();
        }, 1000);
        toast.add({
            title: 'Auto-refresh enabled',
            description: 'Hook stats will update every second',
            duration: 2000,
        });
    } else {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        toast.add({
            title: 'Auto-refresh disabled',
            duration: 2000,
        });
    }
}

// Manual refresh
function refresh() {
    updateSnapshot();
    toast.add({
        title: 'Refreshed',
        duration: 1500,
    });
}

// Clear timings
function clearTimings() {
    resetHookInspectorDiagnostics(hooks._engine);
    updateSnapshot();
    toast.add({
        title: 'Cleared hook diagnostics',
        description: 'All timing and error data has been reset',
        duration: 2000,
    });
}

// Compute stats from reactive snapshot
const stats = computed(() => {
    const totalErrors = Object.values(diagnosticsSnapshot.errors).reduce(
        (sum, count) => sum + count,
        0,
    );

    return {
        totalActions: diagnosticsSnapshot.totalActions,
        totalFilters: diagnosticsSnapshot.totalFilters,
        totalErrors,
    };
});

// Compute hook details from reactive snapshot
const hookDetails = computed(() => {
    const timings = diagnosticsSnapshot.timings;
    const errors = diagnosticsSnapshot.errors;

    const details = Object.entries(timings).map(([name, times]) => {
        const sorted = [...times].sort((a, b) => a - b);
        const aggregate = diagnosticsSnapshot.timingStats[name];
        const count = aggregate?.count ?? sorted.length;
        const sum = aggregate?.total ?? sorted.reduce((acc, t) => acc + t, 0);
        const avg = count > 0 ? (sum / count).toFixed(2) : '0.00';
        const p95Index = Math.min(
            sorted.length - 1,
            Math.floor(sorted.length * 0.95),
        );
        const p95 = sorted.length
            ? (sorted[p95Index]?.toFixed(2) ?? '0.00')
            : '0.00';
        const maxValue = aggregate?.max ?? sorted[sorted.length - 1];
        const max = count > 0 ? (maxValue?.toFixed(2) ?? '0.00') : '0.00';
        const errorCount = errors[name] || 0;

        return {
            name,
            count,
            avg,
            p95,
            max,
            errors: errorCount,
        };
    });

    // Sort by invocation count (descending)
    return details.sort((a, b) => b.count - a.count);
});

// Passive polling - check for updates when visible
let passiveInterval: ReturnType<typeof setInterval> | null = null;
let lastSnapshot = '';

function checkForUpdates() {
    const snapshot = readHookInspectorSnapshot(hooks._engine);
    const currentSnapshot = snapshot.signature;

    // Only update if something actually changed
    if (currentSnapshot !== lastSnapshot) {
        lastSnapshot = currentSnapshot;
        updateSnapshot(snapshot);
    }
}

onMounted(() => {
    // Initial snapshot
    updateSnapshot();
    lastSnapshot = '';

    // Start passive polling every 500ms to detect hook activity
    // Checks counts, not just keys, so it detects new invocations
    passiveInterval = setInterval(() => {
        if (!autoRefresh.value) {
            checkForUpdates();
        }
    }, 500);
});

onUnmounted(() => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (passiveInterval) {
        clearInterval(passiveInterval);
    }
});

// Expose for testing
defineExpose({
    updateSnapshot,
    hookDetails,
    stats,
    diagnosticsSnapshot,
    autoRefresh,
});
</script>
