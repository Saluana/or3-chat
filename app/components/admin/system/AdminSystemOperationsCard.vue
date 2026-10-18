<template>
    <div class="p-5 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
        <h3 class="text-lg font-medium mb-4">Operations</h3>
        <div class="space-y-4">
            <p class="text-sm opacity-70">
                Manage server lifecycle. These actions may cause temporary downtime.
            </p>

            <div
                v-if="!allowRestart || !canRestart && !busy"
                class="p-3 rounded-[var(--md-border-radius-small)] bg-[var(--md-sys-color-info-container,#dbeafe)] border-[length:var(--md-border-width)] border-[var(--md-sys-color-info,#3b82f6)]/20"
            >
                <div class="text-xs font-bold text-[var(--md-sys-color-on-info-container,#1e3a8a)] uppercase mb-1">Info</div>
                <div class="text-sm text-[var(--md-sys-color-on-info-container,#1e40af)]">
                    Dashboard restart requires an enabled, healthy lifecycle controller.
                    Source development uses the standard OR3 dev launcher; managed deployments use the operator.
                </div>
            </div>

            <div class="flex flex-col gap-3">
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-heroicons-arrow-path"
                    :disabled="!isOwner || !allowRestart || !canRestart || savedPending"
                    :loading="busy"
                    @click="emit('restart')"
                >
                    Restart Server
                </UButton>
                <UButton v-if="savedPending" color="neutral" variant="outline" :disabled="!canRestart" @click="emit('apply-saved')">Apply saved settings and restart</UButton>
                <p v-if="progress" role="status" aria-live="polite" class="text-sm">{{ progress }}</p>
                <UButton v-if="needsAttention" color="neutral" variant="outline" :disabled="!isOwner || busy" @click="emit('reconcile')">Recheck existing restart</UButton>
                <UButton v-if="canCancel" color="neutral" variant="outline" :disabled="!isOwner" @click="emit('cancel')">Cancel waiting restart</UButton>
                <p v-if="reason === 'background_drain_unsupported'" class="text-sm">The selected background-job provider has no verified shutdown accounting. Dashboard restart is disabled to protect active jobs.</p>
                <p class="text-xs opacity-70">Restarts wait for active work. Application and bundled theme changes require the supported build or update workflow.</p>
                <NuxtLink to="/documentation/cloud/operations" class="text-xs underline">Restart and recovery guidance</NuxtLink>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    isOwner: boolean;
    allowRestart: boolean;
    canRestart: boolean;
    busy: boolean;
    progress: string;
    savedPending: boolean;
    needsAttention: boolean;
    canCancel: boolean;
    reason?: string;
}>();

const emit = defineEmits<{
    (e: 'restart'): void;
    (e: 'apply-saved'): void;
    (e: 'reconcile'): void;
    (e: 'cancel'): void;
}>();
</script>
