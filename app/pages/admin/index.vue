<template>
    <div class="space-y-6">
        <!-- Header Section -->
        <div>
            <h2 class="text-2xl font-semibold mb-1">Overview</h2>
            <p class="text-sm opacity-70">
                System status and quick widgets.
            </p>
        </div>

        <!-- Loading Skeleton -->
        <div v-if="pending" class="space-y-6 animate-pulse">
            <div class="h-8 w-32 bg-[var(--md-surface-container-highest)] rounded"></div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div v-for="i in 4" :key="i" class="h-24 rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-surface-container-highest)]"></div>
            </div>
        </div>

        <!-- Status Cards Grid -->
        <div v-else-if="status" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
             <div 
                v-for="(item, key) in statusItems" 
                :key="key"
                class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
            >
                <template v-if="item">
                    <div class="text-xs font-medium opacity-60 uppercase tracking-wider mb-1">
                        {{ item.label }}
                    </div>
                    <div class="text-lg font-medium flex items-center gap-2">
                        {{ item.value }}
                        <UBadge 
                            :color="item.enabled ? 'success' : 'neutral'" 
                            variant="subtle" 
                            size="xs"
                        >
                            {{ item.enabled ? 'Enabled' : 'Disabled' }}
                        </UBadge>
                    </div>
                </template>
            </div>
        </div>

        <!-- Warnings -->
        <div v-if="!pending && warnings.length > 0" class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-amber-500/30 bg-amber-500/5">
            <h3 class="text-sm font-semibold text-amber-500 mb-2">System Warnings</h3>
            <div class="space-y-1">
                <div
                    v-for="(w, idx) in warnings"
                    :key="idx"
                    class="text-sm text-amber-600 dark:text-amber-400 flex items-start gap-2"
                >
                    <span class="mt-1">•</span>
                    {{ w.message }}
                </div>
            </div>
        </div>

        <!-- Overview Widgets -->
        <div v-if="!pending && overviewWidgets.length > 0">
             <h3 class="text-lg font-semibold mb-4">Dashboard Widgets</h3>
             <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <component
                    v-for="widget in overviewWidgets"
                    :key="widget.id"
                    :is="resolveAdminComponent(widget)"
                    class="w-full"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    useAdminWidgets,
    resolveAdminComponent,
} from '~/composables/admin/useAdminPlugins';
import type { StatusResponse } from '~/composables/admin/useAdminTypes';

definePageMeta({
    layout: 'admin',
});

const { data, status: fetchStatus } = await useLazyFetch<StatusResponse>('/api/admin/system/status');
const pending = computed(() => fetchStatus.value === 'pending');
const status = computed(() => data.value?.status);
const warnings = computed(() => data.value?.warnings ?? []);
const overviewWidgets = useAdminWidgets('overview');

const statusItems = computed(() => {
    if (!status.value) return {};
    return {
        auth: { label: 'Auth Provider', value: status.value.auth.provider, enabled: status.value.auth.enabled },
        sync: { label: 'Sync Engine', value: status.value.sync.provider, enabled: status.value.sync.enabled },
        storage: { label: 'Storage', value: status.value.storage.provider, enabled: status.value.storage.enabled },
        streaming: { label: 'Bg Streaming', value: status.value.backgroundStreaming.enabled ? 'Active' : 'Inactive', enabled: status.value.backgroundStreaming.enabled },
    };
});
</script>
