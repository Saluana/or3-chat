<template>
    <!-- Root no longer forces full height or its own scroll; parent provides scroll container -->
    <div
        id="dashboard-theme-page-container"
        class="px-4 py-4 space-y-12 text-sm"
    >
        <!-- Theme Selector -->
        <DashboardThemeSelector />

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

<style>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
.supporting-text {
    font-size: 10px;
    line-height: 1.2;
    max-width: 56ch;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.7;
}
</style>
