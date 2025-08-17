<template>
    <div class="p-6 space-y-4">
        <div class="flex flex-row space-x-2">
            <UButton size="sm" color="primary">Nuxt UI Button</UButton>
            <UButton color="success">Nuxt UI Button</UButton>
            <UButton size="lg" color="warning">Nuxt UI Button</UButton>
        </div>

        <div class="flex space-x-2">
            <UInput size="sm" placeholder="Enter email" :ui="{ base: 'peer' }">
            </UInput>
            <UInput size="md" placeholder="Enter email" :ui="{ base: 'peer' }">
            </UInput>
            <UInput size="lg" placeholder="Enter email" :ui="{ base: 'peer' }">
            </UInput>
        </div>

        <div class="flex items-center gap-3">
            <button
                class="px-3 py-1.5 rounded border text-sm bg-[var(--md-primary)] text-[var(--md-on-primary)] border-[var(--md-outline)]"
                @click="toggle()"
            >
                Toggle Light/Dark
            </button>
            <span class="text-[var(--md-on-surface)]"
                >Current: {{ theme }}</span
            >
        </div>

        <div class="grid grid-cols-2 gap-3">
            <div
                class="p-4 rounded bg-[var(--md-surface)] text-[var(--md-on-surface)] border border-[var(--md-outline-variant)]"
            >
                Surface / On-Surface
            </div>
            <div
                class="p-4 rounded bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]"
            >
                Secondary Container
            </div>
            <div
                class="p-4 rounded bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]"
            >
                Tertiary Container
            </div>
            <div
                class="p-4 rounded bg-[var(--md-error-container)] text-[var(--md-on-error-container)]"
            >
                Error Container
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
const nuxtApp = useNuxtApp();
const theme = computed(() => (nuxtApp.$theme as any).get());
const toggle = () => (nuxtApp.$theme as any).toggle();
</script>
