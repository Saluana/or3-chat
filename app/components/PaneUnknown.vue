<template>
    <div
        class="pane-unknown flex-1 flex flex-col items-center justify-center p-8 text-center"
        :data-pane-mode="mode"
    >
        <div class="max-w-md space-y-4">
            <div class="text-6xl opacity-50">
                <UIcon name="pixelarticons:alert" class="w-16 h-16 mx-auto" />
            </div>
            <h2 class="text-xl font-bold text-[var(--md-on-surface)]">
                Unknown Pane Type
            </h2>
            <p class="text-sm opacity-70 text-[var(--md-on-surface-variant)]">
                The pane mode <code class="px-2 py-1 bg-[var(--md-surface-variant)] rounded">{{ mode }}</code> is not recognized.
            </p>
            <p class="text-xs opacity-50 text-[var(--md-on-surface-variant)]">
                This pane app may not be registered or the component failed to load.
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    mode: string;
}>();
</script>
