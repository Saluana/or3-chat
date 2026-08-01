<template>
    <section
        id="dashboard-theme-selector-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-selector-heading"
    >
        <div>
            <h2 id="theme-selector-heading" class="dashboard-section-title">
                Base theme
            </h2>
            <p class="supporting-text mt-1">
                Start with any installed theme. Your token overrides stay
                separate for light and dark mode.
            </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
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
                <span class="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span class="theme-option-mark" aria-hidden="true">
                        <UIcon
                            :name="
                                theme.name === activeTheme
                                    ? useIcon('ui.check').value
                                    : useIcon('dashboard.settings').value
                            "
                            class="h-4 w-4"
                        />
                    </span>
                    <span class="min-w-0">
                        <span class="block font-semibold">{{
                            theme.displayName || theme.name
                        }}</span>
                        <span class="mt-0.5 block truncate text-xs opacity-65">
                            {{
                                theme.description || 'Installed workspace theme'
                            }}
                        </span>
                    </span>
                    <span
                        v-if="theme.name === activeTheme"
                        class="ml-auto text-xs text-[var(--md-primary)]"
                    >
                        Current
                    </span>
                </span>
            </UButton>
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useNuxtApp, useIcon, useRuntimeConfig } from '#imports';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { ThemePlugin } from '~/plugins/90.theme.client';

interface ThemeInfo {
    name: string;
    displayName: string;
    description?: string;
}

const nuxtApp = useNuxtApp();
const themePlugin = nuxtApp.$theme as ThemePlugin;
const runtimeConfig = useRuntimeConfig();

const allThemes = ref<ThemeInfo[]>([]);
const activeTheme = computed(() => themePlugin?.activeTheme?.value || 'retro');

const disabledThemes = computed(() => {
    const raw = (runtimeConfig.public as Record<string, unknown>).branding as
        | Record<string, unknown>
        | undefined;
    const list = raw?.disabledThemes;
    if (Array.isArray(list)) return new Set(list as string[]);
    return new Set<string>();
});

const availableThemes = computed(() =>
    allThemes.value.filter((t) => !disabledThemes.value.has(t.name))
);

onMounted(() => {
    if (themePlugin?.availableThemes) {
        allThemes.value = themePlugin.availableThemes.map((entry) => ({
            name: entry.name,
            displayName:
                entry.displayName ||
                entry.name.charAt(0).toUpperCase() + entry.name.slice(1),
            description: entry.description,
        }));
    } else {
        allThemes.value = [
            { name: 'retro', displayName: 'Retro' },
            { name: 'blank', displayName: 'Blank' },
        ];
    }
});

async function selectTheme(themeName: string) {
    if (!themePlugin?.setActiveTheme) return;
    await themePlugin.setActiveTheme(themeName);
}

const themeButtonOverride = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.theme.selector',
    isNuxtUI: true,
});
const themeButtonProps = computed(() => {
    return {
        size: 'md' as const,
        variant: 'outline' as const,
        color: 'neutral' as const,
        ...themeButtonOverride.value,
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
    min-height: 4.75rem;
    justify-content: stretch;
    padding: 0.8rem;
    text-transform: none;
}
.theme-option-btn.active {
    color: var(--md-on-surface);
    background: var(--md-primary-container);
    border-color: var(--md-primary);
    box-shadow: inset 0 0 0 1px var(--md-primary);
}
.theme-option-mark {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: 0 0 auto;
    place-items: center;
    color: var(--md-primary);
    background: var(--md-surface-container-high);
    border-radius: var(--md-border-radius);
}
</style>
