<template>
    <div class="space-y-4">
        <UCard>
            <template #header>
                <h2 class="text-lg font-semibold">Overview</h2>
            </template>
            <div class="text-sm opacity-80">
                Admin routes are SSR-only and enforced by server-side permissions.
            </div>
        </UCard>

        <UCard v-if="status">
            <template #header>
                <h3 class="text-base font-semibold">System Status</h3>
            </template>
            <div class="space-y-2 text-sm">
                <div>
                    Auth: <span class="font-medium">{{ status.auth.provider }}</span>
                    <span class="opacity-70">({{ status.auth.enabled ? 'enabled' : 'disabled' }})</span>
                </div>
                <div>
                    Sync: <span class="font-medium">{{ status.sync.provider }}</span>
                    <span class="opacity-70">({{ status.sync.enabled ? 'enabled' : 'disabled' }})</span>
                </div>
                <div>
                    Storage: <span class="font-medium">{{ status.storage.provider }}</span>
                    <span class="opacity-70">({{ status.storage.enabled ? 'enabled' : 'disabled' }})</span>
                </div>
                <div>
                    Background Streaming:
                    <span class="font-medium">
                        {{ status.backgroundStreaming.enabled ? 'enabled' : 'disabled' }}
                    </span>
                </div>
                <div v-if="warnings.length > 0" class="mt-3 space-y-1">
                    <div
                        v-for="(w, idx) in warnings"
                        :key="idx"
                        class="text-amber-400"
                    >
                        {{ w.message }}
                    </div>
                </div>
            </div>
        </UCard>

        <UCard v-if="overviewWidgets.length > 0">
            <template #header>
                <h3 class="text-base font-semibold">Admin Widgets</h3>
            </template>
            <div class="space-y-3">
                <component
                    v-for="widget in overviewWidgets"
                    :key="widget.id"
                    :is="resolveAdminComponent(widget)"
                />
            </div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
import {
    useAdminWidgets,
    resolveAdminComponent,
} from '~/composables/admin/useAdminPlugins';

definePageMeta({
    layout: 'admin',
});

const { data } = await useFetch('/api/admin/system/status');
const status = computed(() => data.value?.status);
const warnings = computed(() => data.value?.warnings ?? []);
const overviewWidgets = useAdminWidgets('overview');
</script>
