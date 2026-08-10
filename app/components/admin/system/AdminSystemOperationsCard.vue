<template>
    <div class="p-5 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
        <h3 class="text-lg font-medium mb-4">Operations</h3>
        <div class="space-y-4">
            <p class="text-sm opacity-70">
                Manage server lifecycle. These actions may cause temporary downtime.
            </p>

            <div
                v-if="!allowRestart && !allowRebuild"
                class="p-3 rounded-[var(--md-border-radius-small)] bg-[var(--md-sys-color-info-container,#dbeafe)] border-[length:var(--md-border-width)] border-[var(--md-sys-color-info,#3b82f6)]/20"
            >
                <div class="text-xs font-bold text-[var(--md-sys-color-on-info-container,#1e3a8a)] uppercase mb-1">Info</div>
                <div class="text-sm text-[var(--md-sys-color-on-info-container,#1e40af)]">
                    Server operations are disabled. To enable, set
                    <code class="text-xs bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded-[var(--md-border-radius-small,0.25rem)]">OR3_ADMIN_ALLOW_RESTART=true</code>
                    or
                    <code class="text-xs bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded-[var(--md-border-radius-small,0.25rem)]">OR3_ADMIN_ALLOW_REBUILD=true</code>
                    in your environment.
                </div>
            </div>

            <div class="flex flex-col gap-3">
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-heroicons-arrow-path"
                    :disabled="!isOwner || !allowRestart"
                    @click="emit('restart')"
                >
                    Restart Server
                </UButton>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-heroicons-wrench-screwdriver"
                    :disabled="!isOwner || !allowRebuild"
                    @click="emit('rebuild-restart')"
                >
                    Rebuild & Restart
                </UButton>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    isOwner: boolean;
    allowRestart: boolean;
    allowRebuild: boolean;
}>();

const emit = defineEmits<{
    (e: 'restart'): void;
    (e: 'rebuild-restart'): void;
}>();
</script>
