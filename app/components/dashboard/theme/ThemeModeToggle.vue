<template>
    <section
        id="dashboard-theme-mode-section"
        class="section-card space-y-2"
        role="group"
        aria-labelledby="theme-section-mode"
    >
        <div>
            <h2 id="theme-section-mode" class="dashboard-section-title">
                Editing mode
            </h2>
            <p class="supporting-text mt-1">
                Switch the profile you want to customize.
            </p>
        </div>
        <div class="theme-mode-control" aria-label="Theme mode">
            <UButton
                v-bind="themeModeButtonProps"
                :class="activeMode === 'light' ? 'active' : ''"
                :disabled="activeMode === 'light'"
                :aria-pressed="activeMode === 'light'"
                @click="switchMode('light')"
                >Light</UButton
            >
            <UButton
                v-bind="themeModeButtonProps"
                :class="activeMode === 'dark' ? 'active' : ''"
                :disabled="activeMode === 'dark'"
                :aria-pressed="activeMode === 'dark'"
                @click="switchMode('dark')"
                >Dark</UButton
            >
        </div>
        <p class="text-xs opacity-70">
            {{ activeMode === 'light' ? 'Light' : 'Dark' }} tokens are active
            and previewed live across the app.
        </p>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const themeApi = useUserThemeOverrides();
const activeMode = themeApi.activeMode;
const switchMode = themeApi.switchMode;

const themeModeOverrides = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.theme.mode',
    isNuxtUI: true,
});

const themeModeButtonProps = computed(() => ({
    size: 'sm' as const,
    variant: 'soft' as const,
    color: 'primary' as const,
    ...(themeModeOverrides.value as any),
}));
</script>

<style scoped>
.theme-mode-control {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
    padding: 0.3rem;
    background: var(--md-surface-container-low);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
</style>
