<template>
    <section
        id="dashboard-theme-reset-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-section-reset"
    >
        <h2
            id="theme-section-reset"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Reset
        </h2>
        <UButton
            v-bind="resetAllButtonProps"
            class="px-3 py-2 text-xs"
            @click="onResetAll"
        >
            Reset All
        </UButton>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const themeApi = useUserThemeOverrides();
const resetAll = themeApi.resetAll;

const resetAllButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.reset-all',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

function onResetAll() {
    if (confirm('Reset BOTH light and dark theme settings to defaults?')) {
        resetAll();
    }
}
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
</style>
