<template>
    <div v-if="actions.length > 0">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
                v-for="action in actions"
                :key="action.kind + ':' + action.id"
                :id="isStorageUsage(action) ? 'storage-usage' : undefined"
                class="flex min-w-0 flex-col scroll-mt-4 p-4 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)]"
            >
                <div class="flex justify-between items-start mb-2">
                    <div class="text-xs font-bold uppercase opacity-50 tracking-wider">{{ action.kind }}</div>
                    <div class="text-xs opacity-50">{{ action.provider }}</div>
                </div>

                <div class="font-medium text-base mb-1 break-words">{{ action.label }}</div>
                <div v-if="action.description" class="text-sm opacity-70 mb-4 break-words">
                    {{ action.description }}
                </div>
                <UButton
                    class="mt-auto"
                    size="xs"
                    block
                    :color="action.danger ? 'warning' : 'primary'"
                    :variant="action.danger ? 'soft' : 'solid'"
                    :disabled="!isOwner || !!runningActionId"
                    :loading="runningActionId === action.kind + ':' + action.id"
                    @click="emit('run', action)"
                >
                    {{ isStorageUsage(action) ? 'View storage usage' : 'Run action' }}
                </UButton>
            </div>
        </div>
        <section v-if="result" id="provider-action-result" role="status" tabindex="-1" class="mt-4 scroll-mt-20 lg:scroll-mt-4 space-y-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] p-4 sm:p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h4 class="text-lg font-semibold">{{ result.label }}{{ storageUsage ? '' : ' result' }}</h4>
                <span v-if="storageUsage?.partial" class="rounded-full bg-[var(--md-surface-container-high)] px-3 py-1 text-xs font-medium">Partial scan</span>
            </div>
            <template v-if="storageUsage">
                <dl v-if="storageUsage.metrics.length" class="flex flex-wrap gap-3">
                    <div v-for="metric in storageUsage.metrics" :key="metric.label" class="min-w-40 flex-1 rounded-xl bg-[var(--md-surface-container-low)] p-4">
                        <dt class="text-sm opacity-70">{{ metric.label }}</dt>
                        <dd class="mt-2">
                            <span class="text-2xl font-semibold tabular-nums">{{ formatBytes(metric.bytes) }}</span>
                            <span v-if="metric.description" class="mt-1 block text-xs opacity-60">{{ metric.description }}</span>
                        </dd>
                    </div>
                </dl>
                <p v-if="!storageUsage.metrics.length" class="text-sm opacity-70">Storage usage couldn’t be measured for this workspace.</p>
                <p v-else-if="storageUsage.partial" class="text-sm opacity-70">The disk total may be higher. Some files could not be checked.</p>
                <p v-else-if="storageUsage.incomplete" class="text-sm opacity-70">Some storage information is unavailable.</p>
                <dl v-if="storageUsage.serverAvailable !== null" class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <dt class="opacity-70">Server space available</dt>
                    <dd class="font-medium tabular-nums">{{ formatBytes(storageUsage.serverAvailable) }}</dd>
                </dl>
                <details class="border-t border-[var(--md-outline-variant)] pt-3">
                    <summary class="w-fit cursor-pointer rounded text-sm opacity-70 focus-visible:outline-2 focus-visible:outline-offset-4">Show JSON</summary>
                    <pre class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--md-surface-container-low)] p-3 text-xs">{{ JSON.stringify(result.value, null, 2) }}</pre>
                </details>
            </template>
            <pre v-else class="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{{ JSON.stringify(result.value, null, 2) }}</pre>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Action {
    id: string;
    label: string;
    kind: 'auth' | 'sync' | 'storage';
    provider: string;
    danger?: boolean;
    description?: string;
}

const props = defineProps<{
    actions: Action[];
    isOwner: boolean;
    runningActionId?: string | null;
    result?: { label: string; value: unknown; storageUsage?: boolean } | null;
}>();

const emit = defineEmits<{
    run: [action: Action];
}>();

const isStorageUsage = (action: Action) => action.kind === 'storage' && action.id === 'storage.usage';

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

function byteCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const storageUsage = computed(() => {
    if (!props.result?.storageUsage) return null;
    const value = record(props.result.value);
    const canonical = record(value?.canonical);
    const complete = record(canonical?.complete);
    const filesystem = record(value?.filesystem);
    const active = complete?.activeMetadata === true ? byteCount(canonical?.activeMetadataBytes) : null;
    const trash = complete?.retainedDeletedMetadata === true ? byteCount(canonical?.retainedDeletedMetadataBytes) : null;
    const disk = byteCount(filesystem?.apparentFileBytes);
    return {
        metrics: [
            { label: 'Active files', bytes: active },
            { label: 'In Trash', bytes: trash },
            { label: 'Files on disk', bytes: disk, description: 'Includes Trash and supporting files' },
        ].flatMap(metric => metric.bytes === null ? [] : [{ ...metric, bytes: metric.bytes }]),
        partial: disk !== null && filesystem?.complete !== true,
        incomplete: active === null || trash === null || disk === null,
        serverAvailable: byteCount(record(value?.volume)?.availableBytes),
    };
});

function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const unit = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit);
    return `${amount} ${units[unit]}`;
}
</script>
