<template>
    <section
        id="dashboard-theme-selector-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-selector-heading"
    >
        <h2
            id="theme-selector-heading"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Theme
        </h2>
        <p class="supporting-text">
            Choose a visual theme for the interface. Themes sync across all your
            devices.
        </p>

        <div class="flex flex-wrap gap-3">
            <UButton
                v-for="theme in availableThemes"
                :key="theme.name"
                :id="`dashboard-theme-btn-${theme.name}`"
                v-bind="themeButtonProps"
                :class="[
                    'theme-option-btn',
                    theme.name === activeTheme ? 'active' : '',
                ]"
                :active="theme.name === activeTheme"
                :aria-pressed="theme.name === activeTheme"
                @click="selectTheme(theme.name)"
            >
                <span class="flex items-center gap-2">
                    <UIcon
                        v-if="theme.name === activeTheme"
                        :name="useIcon('ui.check').value"
                        class="w-4 h-4"
                    />
                    <span>{{ theme.displayName || theme.name }}</span>
                </span>
            </UButton>
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useNuxtApp, useIcon } from '#imports';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { ThemePlugin } from '~/theme/_shared/types';
import { FALLBACK_THEME_NAME } from '~/theme/_shared/constants';

interface ThemeInfo {
    name: string;
    displayName: string;
    description?: string;
}

const nuxtApp = useNuxtApp();
const themePlugin = nuxtApp.$theme as ThemePlugin;

const availableThemes = ref<ThemeInfo[]>([]);
const activeTheme = computed(
    () => themePlugin?.activeTheme?.value || FALLBACK_THEME_NAME
);

onMounted(async () => {
    // Load available themes from manifest
    try {
        const { loadThemeManifest } = await import(
            '~/theme/_shared/theme-manifest'
        );
        const { entries } = await loadThemeManifest();
        availableThemes.value = entries.map((entry) => ({
            name: entry.name,
            displayName:
                entry.definition?.displayName ||
                entry.name.charAt(0).toUpperCase() + entry.name.slice(1),
            description: entry.definition?.description,
        }));
    } catch (error) {
        console.error('[ThemeSelector] Failed to load theme manifest:', error);
        // Fallback to known themes
        availableThemes.value = [
            { name: 'retro', displayName: 'Retro' },
            { name: 'blank', displayName: 'Blank' },
        ];
    }
});

async function selectTheme(themeName: string) {
    if (!themePlugin?.setActiveTheme) return;
    await themePlugin.setActiveTheme(themeName);
}

const themeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.selector',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        variant: 'soft' as const,
        color: 'primary' as const,
        ...(overrides.value as any),
    };
});
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
.supporting-text {
    font-size: 15px;
    line-height: 1.2;
    max-width: 82ch;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.7;
}
.theme-option-btn {
    min-width: 100px;
    text-transform: capitalize;
}
.theme-option-btn.active {
    box-shadow: inset 0 0 0 2px var(--md-primary);
}
</style>
