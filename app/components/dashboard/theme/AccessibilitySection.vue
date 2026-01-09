<template>
    <section
        id="dashboard-theme-accessibility-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-section-accessibility"
    >
        <h2
            id="theme-section-accessibility"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Accessibility
        </h2>
        <label class="flex items-center gap-2 cursor-pointer select-none">
            <input
                type="checkbox"
                :checked="
                    overrides.ui?.reducePatternsInHighContrast ?? false
                "
                @change="toggleReduceHighContrast"
            />
            <span class="text-xs"
                >Reduce pattern opacity in high contrast modes</span
            >
        </label>
    </section>
</template>

<script setup lang="ts">
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;
const reapply = themeApi.reapply;

function toggleReduceHighContrast() {
    const current = overrides.value.ui?.reducePatternsInHighContrast ?? false;
    set({
        ui: { reducePatternsInHighContrast: !current },
    });
    reapply();
}
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
</style>
