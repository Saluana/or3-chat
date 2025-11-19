<template>
    <div class="space-y-4">
        <h2 class="text-lg font-semibold flex items-center gap-2">
            <UIcon name="pixelarticons:dashboard" class="w-5 h-5" /> Overview
        </h2>
        <p class="text-sm opacity-80 max-w-prose">
            This is a lazily loaded overview page. Modify this component inside
            the example plugin to test HMR and page switching.
        </p>
        <div class="grid sm:grid-cols-3 gap-4">
            <div
                class="p-3 rounded-md border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1">Metric A</div>
                <div class="text-xl font-bold tracking-tight">42</div>
            </div>
            <div
                class="p-3 rounded-md border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1">Metric B</div>
                <div class="text-xl font-bold tracking-tight">3.14</div>
            </div>
            <div
                class="p-3 rounded-md border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
            >
                <div class="text-xs opacity-60 mb-1">Metric C</div>
                <div class="text-xl font-bold tracking-tight">99%</div>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
// Simple demo content only
</script>
