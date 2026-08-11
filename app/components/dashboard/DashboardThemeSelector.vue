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
                Start with any installed theme. Your customizations stay
                separate for light and dark mode.
            </p>
        </div>

        <div class="theme-option-grid">
            <UButton
                v-for="theme in availableThemes"
                :key="theme.name"
                :id="`dashboard-theme-btn-${theme.name}`"
                v-bind="themeButtonProps"
                :class="[
                    'theme-option-btn',
                    theme.name === activeTheme ? 'active' : '',
                ]"
                :aria-pressed="theme.name === activeTheme"
                :aria-current="theme.name === activeTheme ? 'true' : undefined"
                @click="selectTheme(theme.name)"
            >
                <span class="flex min-w-0 w-full flex-1 items-center gap-3 text-left">
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
                    <span class="min-w-0 flex-1">
                        <span class="block font-semibold break-words">{{
                            theme.displayName || theme.name
                        }}</span>
                        <span class="theme-option-description">
                            {{
                                theme.description || 'Installed workspace theme'
                            }}
                        </span>
                    </span>
                    <span
                        v-if="theme.name === activeTheme"
                        class="theme-current-badge"
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
    line-height: 1.35;
    max-width: min(82ch, 100%);
    color: var(--md-on-surface);
    overflow-wrap: break-word;
}
.theme-option-grid {
    display: grid;
    grid-auto-rows: 1fr;
    gap: 0.75rem;
}
.theme-option-btn {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    height: 100%;
    min-height: 6rem;
    justify-content: stretch;
    padding: 0.8rem;
    text-transform: none;
    white-space: normal;
    color: var(--md-on-surface) !important;
    background: var(--md-surface) !important;
    border-color: var(--md-border-color) !important;
    transition:
        background-color var(--app-motion-duration-fast, 120ms)
            var(--app-motion-easing-standard, ease),
        border-color var(--app-motion-duration-fast, 120ms)
            var(--app-motion-easing-standard, ease),
        box-shadow var(--app-motion-duration-fast, 120ms)
            var(--app-motion-easing-standard, ease);
}
.theme-option-btn :deep([data-slot='base']),
.theme-option-btn :deep([data-slot='label']) {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
}
.theme-option-btn :deep([data-slot='label']) {
    color: inherit !important;
}
.theme-option-btn.active {
    color: var(--md-on-surface) !important;
    background: var(--md-surface) !important;
    border-color: var(--md-primary) !important;
    border-width: var(--md-border-width-strong);
    box-shadow: inset 0 0 0 var(--md-border-width) var(--md-primary);
}
.theme-option-btn:hover {
    color: var(--md-on-surface) !important;
    background: var(
        --md-surface-hover,
        var(--md-surface-container-high, var(--md-surface))
    ) !important;
    border-color: var(--md-primary) !important;
}
.theme-option-btn.active:hover {
    color: var(--md-on-surface) !important;
    background: var(
        --md-surface-hover,
        var(--md-surface-container-high, var(--md-surface))
    ) !important;
    border-color: var(--md-primary) !important;
}
.theme-option-btn:focus-visible {
    outline: var(--app-focus-ring-width, 3px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
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
.theme-option-btn.active .theme-option-mark {
    color: var(--md-on-primary);
    background: var(--md-primary);
}
.theme-option-description {
    display: -webkit-box;
    margin-top: 0.2rem;
    overflow: hidden;
    color: color-mix(in srgb, var(--md-on-surface) 82%, var(--md-surface));
    font-size: 0.75rem;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}
.theme-current-badge {
    flex: 0 0 auto;
    margin-left: auto;
    padding: 0.2rem 0.4rem;
    color: var(--md-on-primary);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: var(--md-primary);
    border-radius: var(--md-border-radius-small);
}
@media (min-width: 640px) {
    .theme-option-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
