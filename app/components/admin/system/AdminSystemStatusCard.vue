<template>
    <div class="p-5 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
        <h3 class="text-lg font-medium mb-4">Status</h3>
        <div class="space-y-3 text-sm">
            <div class="flex justify-between items-center py-2 border-b-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[var(--md-outline-variant)]/50">
                <span class="opacity-70">Auth Provider</span>
                <div class="flex items-center gap-2">
                    <span class="font-medium">{{ status.auth.provider }}</span>
                    <div class="w-2 h-2 rounded-full" :class="status.auth.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'" />
                </div>
            </div>
            <div class="flex justify-between items-center py-2 border-b-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[var(--md-outline-variant)]/50">
                <span class="opacity-70">Sync Engine</span>
                <div class="flex items-center gap-2">
                    <span class="font-medium">{{ status.sync.provider }}</span>
                    <div class="w-2 h-2 rounded-full" :class="status.sync.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'" />
                </div>
            </div>
            <div class="flex justify-between items-center py-2 border-b-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[var(--md-outline-variant)]/50">
                <span class="opacity-70">Storage</span>
                <div class="flex items-center gap-2">
                    <span class="font-medium">{{ status.storage.provider }}</span>
                    <div class="w-2 h-2 rounded-full" :class="status.storage.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'" />
                </div>
            </div>
            <div class="flex justify-between items-center py-2">
                <span class="opacity-70">Background Streaming</span>
                <div class="flex items-center gap-2">
                    <span class="font-medium">{{ status.backgroundStreaming.enabled ? 'Active' : 'Inactive' }}</span>
                    <div class="w-2 h-2 rounded-full" :class="status.backgroundStreaming.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'" />
                </div>
            </div>
        </div>

        <div v-if="warnings.length > 0" class="mt-6 p-3 rounded-[var(--md-border-radius-small)] bg-[var(--md-sys-color-warning-container,#fef3c7)] border-[length:var(--md-border-width)] border-[var(--md-sys-color-warning,#f59e0b)]/20">
            <div class="text-xs font-bold text-[var(--md-sys-color-on-warning-container,#92400e)] uppercase mb-2">Warnings</div>
            <div class="space-y-1">
                <div v-for="(w, idx) in warnings" :key="idx" class="text-sm text-[var(--md-sys-color-on-warning-container,#92400e)]">
                    • {{ w.message }}
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    status: {
        auth: { provider: string; enabled: boolean };
        sync: { provider: string; enabled: boolean };
        storage: { provider: string; enabled: boolean };
        backgroundStreaming: { enabled: boolean };
    };
    warnings: Array<{ message: string }>;
}>();
</script>
