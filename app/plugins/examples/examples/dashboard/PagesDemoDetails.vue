<template>
    <div class="space-y-4">
        <h2 class="text-lg font-semibold flex items-center gap-2">
            <UIcon name="pixelarticons:list-check" class="w-5 h-5" /> Details
        </h2>
        <p class="text-sm opacity-80 max-w-prose">
            A second lazily loaded page to demonstrate multi-page navigation.
            Add more complex UI, forms, or data visualizations here.
        </p>
        <ul class="list-disc pl-5 text-sm space-y-1">
            <li>Lazy-loaded component code-splits automatically.</li>
            <li>
                Navigation back to the dashboard keeps page cache in memory.
            </li>
            <li>Edit this file to see HMR update while open.</li>
        </ul>
    </div>
</template>
<script setup lang="ts">
// Demo page only
</script>
