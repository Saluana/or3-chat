<template>
    <section
        id="dashboard-theme-mode-section"
        class="section-card theme-mode-section"
    >
        <div class="theme-mode-copy">
            <h2 id="theme-section-mode" class="dashboard-section-title">
                Color mode
            </h2>
            <p id="theme-mode-help" class="supporting-text mt-1">
                {{ APPEARANCE_SETTING_DESCRIPTIONS.mode }}
            </p>
        </div>
        <div class="theme-mode-control" role="group" aria-labelledby="theme-section-mode" aria-describedby="theme-mode-help">
            <button
                type="button"
                class="theme-mode-option"
                :class="activeMode === 'light' ? 'active' : ''"
                :aria-pressed="activeMode === 'light'"
                @click="selectMode('light')"
            >
                <UIcon
                    v-if="activeMode === 'light'"
                    :name="hoistedUiCheckIcon"
                    class="h-4 w-4"
                />
                Light
            </button>
            <button
                type="button"
                class="theme-mode-option"
                :class="activeMode === 'dark' ? 'active' : ''"
                :aria-pressed="activeMode === 'dark'"
                @click="selectMode('dark')"
            >
                <UIcon
                    v-if="activeMode === 'dark'"
                    :name="hoistedUiCheckIcon"
                    class="h-4 w-4"
                />
                Dark
            </button>
        </div>
    </section>
</template>

<script setup lang="ts">
const hoistedUiCheckIcon = useIcon('ui.check');

import { useIcon } from '#imports';
import { APPEARANCE_SETTING_DESCRIPTIONS } from '~/core/theme/appearance-setting-descriptions';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

const themeApi = useUserThemeOverrides();
const activeMode = themeApi.activeMode;
const switchMode = themeApi.switchMode;

function selectMode(mode: 'light' | 'dark') {
    if (mode !== activeMode.value) switchMode(mode);
}
</script>

<style scoped>
.theme-mode-control {
    display: flex;
    width: min(100%, 12rem);
    gap: 0.25rem;
    padding: 0.25rem;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.theme-mode-option {
    display: inline-flex;
    flex: 1 1 0;
    min-width: 0;
    min-height: 2.4rem;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border-style: solid;
    border-color: transparent;
    border-width: var(--md-border-width);
    border-radius: var(--md-border-radius-small);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
}
.theme-mode-option.active {
    color: var(--md-on-primary) !important;
    background: var(--md-primary) !important;
    border-color: var(--md-primary) !important;
}
.theme-mode-option:not(.active):hover {
    color: var(--md-on-surface) !important;
    background: var(
        --md-surface-hover,
        var(--md-surface-container-high, var(--md-surface))
    ) !important;
}
.theme-mode-option.active:hover {
    color: var(--md-on-primary) !important;
    background: var(--md-primary-hover, var(--md-primary)) !important;
    border-color: var(--md-primary) !important;
}
.theme-mode-option:active {
    translate: 0 var(--md-border-width-subtle);
}
.theme-mode-option:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
.theme-mode-section {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.85rem;
}
</style>
