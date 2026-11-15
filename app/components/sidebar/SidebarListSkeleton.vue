<template>
    <!-- One placeholder for every sidebar loading stage (server render, page
         chunk, first list read) so boot shows a single steady skeleton. -->
    <div class="p-4 space-y-4 animate-pulse" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-[var(--md-border-radius)] bg-[var(--md-surface-variant)]" />
            <div class="flex-1 space-y-2">
                <div class="h-4 w-3/4 rounded bg-[var(--md-surface-variant)]" />
                <div class="h-3 w-1/4 rounded bg-[var(--md-surface-variant)]" />
            </div>
        </div>
    </div>
</template>
