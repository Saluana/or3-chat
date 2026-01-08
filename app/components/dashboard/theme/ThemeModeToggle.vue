<template>
    <section
        id="dashboard-theme-mode-section"
        class="section-card space-y-2"
        role="group"
        aria-labelledby="theme-section-mode"
    >
        <div class="flex items-center justify-between flex-wrap gap-3">
            <h2
                id="theme-section-mode"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Theme Mode
            </h2>
            <div class="flex gap-2 items-center">
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
                <UButton
                    v-bind="themeModeButtonProps"
                    aria-label="Reset current theme mode"
                    @click="onResetCurrent"
                    :title="'Reset ' + activeMode + ' profile'"
                    >Reset {{ activeMode }}</UButton
                >
            </div>
        </div>
        <p class="text-xs opacity-70">
            Each mode stores its own backgrounds & colors. Use Reset (mode)
            for just this profile or Reset All below for both.
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
const reset = themeApi.reset;

const themeModeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.mode',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

function onResetCurrent() {
    if (confirm(`Reset ${activeMode.value} theme settings to defaults?`)) {
        reset();
    }
}
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
</style>
