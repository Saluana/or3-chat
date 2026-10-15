<template>
    <section
        id="dashboard-theme-mode-section"
        class="section-card theme-mode-section"
        role="group"
        aria-labelledby="theme-section-mode"
    >
        <div class="theme-mode-copy">
            <h2 id="theme-section-mode" class="dashboard-section-title">
                Edit color mode
            </h2>
            <p class="supporting-text mt-1">
                Choose which color mode to customize. Changes are previewed
                live across the app.
            </p>
        </div>
        <div class="theme-mode-row">
            <span class="theme-mode-label">Customize:</span>
            <div class="theme-mode-control" role="group" aria-label="Theme mode">
                <button
                    type="button"
                    class="theme-mode-option"
                    :class="activeMode === 'light' ? 'active' : ''"
                    :aria-pressed="activeMode === 'light'"
                    @click="selectMode('light')"
                >
                    <UIcon
                        v-if="activeMode === 'light'"
                        :name="useIcon('ui.check').value"
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
                        :name="useIcon('ui.check').value"
                        class="h-4 w-4"
                    />
                    Dark
                </button>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { useIcon } from '#imports';
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
    flex: 1 1 14rem;
    max-width: 18rem;
    gap: 0.25rem;
    padding: 0.25rem;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.theme-mode-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem 1rem;
}
.theme-mode-label {
    color: var(--md-on-surface);
    font-size: 0.78rem;
    font-weight: 700;
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
