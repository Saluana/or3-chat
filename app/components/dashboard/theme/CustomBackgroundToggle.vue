<template>
    <section
        id="dashboard-theme-custom-backgrounds-section"
        class="section-card space-y-2"
        role="group"
        aria-labelledby="theme-section-custom-bg"
    >
        <h2
            id="theme-section-custom-bg"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Custom Background Colors
        </h2>
        <label class="flex items-center gap-2 cursor-pointer select-none">
            <input
                type="checkbox"
                :checked="overrides.backgrounds?.enabled ?? false"
                @change="toggleBackgrounds"
            />
            <span class="text-xs"
                >Enable custom background color overrides</span
            >
        </label>
        <p
            class="text-xs opacity-70"
            v-if="!(overrides.backgrounds?.enabled ?? false)"
        >
            Disabled: system/theme background colors shown.
        </p>
        <p class="text-xs opacity-70" v-else>
            Enabled: custom values below override system backgrounds.
        </p>
    </section>
</template>

<script setup lang="ts">
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;
const reapply = themeApi.reapply;

function toggleBackgrounds() {
    set({
        backgrounds: {
            enabled: !(overrides.value.backgrounds?.enabled ?? false),
        },
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
