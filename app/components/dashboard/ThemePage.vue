<template>
    <!-- Root no longer forces full height or its own scroll; parent provides scroll container -->
    <div
        id="dashboard-theme-page-container"
        class="px-4 py-4 space-y-12 text-sm"
    >
        <!-- Accessible live region for status updates -->
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>

        <!-- Mode Toggle -->
        <DashboardThemeModeToggle />

        <!-- Color Palette Overrides -->
        <DashboardThemeColorPaletteSection />

        <!-- Custom Background Colors Master Toggle -->
        <DashboardThemeCustomBackgroundToggle />

        <!-- Typography -->
        <DashboardThemeTypographySection />

        <!-- Background Layers (Content 1, Content 2, Sidebar) -->
        <DashboardThemeBackgroundLayersSection />

        <!-- Accessibility -->
        <DashboardThemeAccessibilitySection />

        <!-- Reset -->
        <DashboardThemeResetSection />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

// Live status ref for accessibility announcements (can be used by composables if needed)
const liveStatus = ref<HTMLElement | null>(null);
</script>

<style scoped>
/* Component-specific layout and typography (non-decorative) */
.group-heading {
    margin-top: -0.25rem; /* optical align */
    letter-spacing: 0.08em;
}
.supporting-text {
    font-size: 10px;
    line-height: 1.2;
    max-width: 56ch;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.7;
}
.fallback-row {
    flex-wrap: wrap;
}
.fallback-row > label {
    flex: 0 0 120px;
}
.fallback-row .theme-input {
    width: 92px;
}
@media (max-width: 560px) {
    .fallback-row {
        align-items: flex-start;
    }
    .fallback-row > label {
        width: 100%;
        margin-bottom: 4px;
    }
    .fallback-row .theme-input {
        width: 100px;
    }
}
</style>
