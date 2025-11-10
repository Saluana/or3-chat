<template>
    <div class="space-y-4">
        <!-- Header -->
        <div class="flex items-center justify-between">
            <div>
                <h2 class="text-lg font-semibold flex items-center gap-2">
                    <UIcon name="pixelarticons:sync" class="w-5 h-5" />
                    Hook Inspector
                </h2>
                <p class="text-sm opacity-70 mt-1">
                    Monitor hook performance, execution counts, and errors
                </p>
            </div>
            <div class="flex items-center gap-2">
                <UButton
                    size="sm"
                    variant="outline"
                    icon="pixelarticons:reload"
                    :disabled="autoRefresh"
                    @click="refresh"
                >
                    Refresh
                </UButton>
                <UButton
                    size="sm"
                    :variant="autoRefresh ? 'solid' : 'outline'"
                    :icon="
                        autoRefresh
                            ? 'pixelarticons:checkbox-on'
                            : 'pixelarticons:checkbox'
                    "
                    @click="toggleAutoRefresh"
                >
                    Auto
                </UButton>
                <UButton
                    size="sm"
                    variant="outline"
                    icon="pixelarticons:trash"
                    color="error"
                    @click="clearTimings"
                >
                    Clear
                </UButton>
            </div>
        </div>

        <!-- Documentation Link -->
        <div
            class="p-3 rounded-md border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
        >
            <div class="flex items-start gap-2">
                <UIcon
                    name="pixelarticons:book"
                    class="w-4 h-4 mt-0.5 opacity-60"
                />
                <div class="text-sm flex-1">
                    <span class="opacity-80">
                        See the
                        <a
                            href="/docs/core-hook-map.md"
                            target="_blank"
                            class="underline hover:opacity-100"
                        >
                            Core Hook Map
                        </a>
                        documentation for a complete list of available hooks and
                        their payloads.
                    </span>
                </div>
            </div>
        </div>

        <!-- Summary Cards -->
        <div class="grid sm:grid-cols-3 gap-4">
            <div
                class="p-4 rounded-md border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1">Total Actions</div>
                <div class="text-2xl font-bold tracking-tight">
                    {{ stats.totalActions }}
                </div>
            </div>
            <div
                class="p-4 rounded-md border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1">Total Filters</div>
                <div class="text-2xl font-bold tracking-tight">
                    {{ stats.totalFilters }}
                </div>
            </div>
            <div
                class="p-4 rounded-md border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1">Total Errors</div>
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
            class="rounded-md border border-[var(--md-outline-variant)] overflow-hidden"
        >
            <div
                class="bg-[var(--md-surface-container-high)] px-4 py-2 border-b border-[var(--md-outline-variant)]"
            >
                <h3 class="text-sm font-semibold">Hook Details</h3>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead
                        class="bg-[var(--md-surface-container)] border-b border-[var(--md-outline-variant)]"
                    >
                        <tr>
                            <th
                                class="px-4 py-2 text-left font-medium opacity-70"
                            >
                                Hook Name
                            </th>
                            <th
                                class="px-4 py-2 text-right font-medium opacity-70"
                            >
                                Invocations
                            </th>
                            <th
                                class="px-4 py-2 text-right font-medium opacity-70"
                            >
                                Avg (ms)
                            </th>
                            <th
                                class="px-4 py-2 text-right font-medium opacity-70"
                            >
                                P95 (ms)
                            </th>
                            <th
                                class="px-4 py-2 text-right font-medium opacity-70"
                            >
                                Max (ms)
                            </th>
                            <th
                                class="px-4 py-2 text-right font-medium opacity-70"
                            >
                                Errors
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="hook in hookDetails"
                            :key="hook.name"
                            class="border-b border-[var(--md-outline-variant)] hover:bg-[var(--md-surface-container-low)]"
                        >
                            <td class="px-4 py-2 font-mono text-xs">
                                {{ hook.name }}
                            </td>
                            <td class="px-4 py-2 text-right tabular-nums">
                                {{ hook.count }}
                            </td>
                            <td class="px-4 py-2 text-right tabular-nums">
                                {{ hook.avg }}
                            </td>
                            <td class="px-4 py-2 text-right tabular-nums">
                                {{ hook.p95 }}
                            </td>
                            <td class="px-4 py-2 text-right tabular-nums">
                                {{ hook.max }}
                            </td>
                            <td
                                class="px-4 py-2 text-right tabular-nums"
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

const hooks = useHooks();
const toast = useToast();

// State - use reactive copies of the diagnostics data
const autoRefresh = ref(false);
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// Reactive snapshot of diagnostics
const diagnosticsSnapshot = reactive({
    timings: {} as Record<string, number[]>,
    errors: {} as Record<string, number>,
    totalActions: 0,
    totalFilters: 0,
});

// Update snapshot from hooks engine
function updateSnapshot() {
    // Deep clone timings to make it reactive
    const timings = hooks._diagnostics.timings;
    diagnosticsSnapshot.timings = {};
    for (const [key, value] of Object.entries(timings)) {
        diagnosticsSnapshot.timings[key] = [...value];
    }

    // Deep clone errors
    const errors = hooks._diagnostics.errors;
    diagnosticsSnapshot.errors = { ...errors };

    // Update counts
    diagnosticsSnapshot.totalActions = hooks._diagnostics.callbacks('action');
    diagnosticsSnapshot.totalFilters = hooks._diagnostics.callbacks('filter');
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
    hooks._diagnostics.timings = {};
    hooks._diagnostics.errors = {};
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
        0
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
        const count = sorted.length;
        const sum = sorted.reduce((acc, t) => acc + t, 0);
        const avg = count > 0 ? (sum / count).toFixed(2) : '0.00';
        const p95Index = Math.floor(count * 0.95);
        const p95 = count > 0 ? sorted[p95Index]?.toFixed(2) ?? '0.00' : '0.00';
        const max =
            count > 0 ? sorted[count - 1]?.toFixed(2) ?? '0.00' : '0.00';
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
    // Create a signature of current diagnostics state
    const timingKeys = Object.keys(hooks._diagnostics.timings).sort().join(',');
    const timingCounts = Object.values(hooks._diagnostics.timings)
        .map((arr) => arr.length)
        .join(',');
    const errorCounts = Object.values(hooks._diagnostics.errors).join(',');
    const currentSnapshot = `${timingKeys}:${timingCounts}:${errorCounts}`;

    // Only update if something actually changed
    if (currentSnapshot !== lastSnapshot) {
        lastSnapshot = currentSnapshot;
        updateSnapshot();
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
