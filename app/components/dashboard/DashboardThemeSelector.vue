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
                    <span
                        class="theme-swatch"
                        aria-hidden="true"
                        :style="{ background: swatches[theme.name]?.surface }"
                    >
                        <span
                            v-for="(color, index) in swatches[theme.name]?.accents"
                            :key="index"
                            class="theme-swatch-dot"
                            :style="{ background: color }"
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
import { useNuxtApp, useRuntimeConfig } from '#imports';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
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

// Compiled variable blocks per theme: the light block first, then `.dark` overrides.
const themeVariables = ref<Record<string, string>>({});
const activeMode = useUserThemeOverrides().activeMode;
const SWATCH_TOKENS = ['--md-primary', '--md-secondary', '--md-tertiary'];

const swatches = computed(() =>
    Object.fromEntries(
        Object.entries(themeVariables.value).map(([name, css]) => {
            const colors: Record<string, string> = {};
            for (const block of css.split('}')) {
                const [selector = '', body = ''] = block.split('{');
                if (selector.includes('.dark') && activeMode.value !== 'dark') continue;
                for (const [, token = '', value = ''] of body.matchAll(
                    /(--md-(?:primary|secondary|tertiary|surface)):\s*([^;]+);/g
                )) {
                    colors[token] = value.trim();
                }
            }
            return [
                name,
                {
                    surface: colors['--md-surface'],
                    accents: SWATCH_TOKENS.flatMap((token) => colors[token] ?? []),
                },
            ];
        })
    )
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
    for (const { name } of allThemes.value) {
        void themePlugin
            ?.loadTheme?.(name)
            .then((compiled) => {
                if (compiled?.cssVariables) {
                    themeVariables.value = {
                        ...themeVariables.value,
                        [name]: compiled.cssVariables,
                    };
                }
            })
            .catch(() => undefined);
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
    /* Themes may set these widths to 0; the selected card still needs an outline. */
    border-width: max(var(--md-border-width-strong, 0px), 1px);
    box-shadow: inset 0 0 0 max(var(--md-border-width, 0px), 1px) var(--md-primary);
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
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
.theme-swatch {
    display: flex;
    width: 2.75rem;
    height: 2.75rem;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    background: var(--md-surface-container-high, var(--md-surface-variant));
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.theme-swatch-dot {
    width: 0.55rem;
    height: 1.4rem;
    border-radius: var(--md-border-radius-small, 0.25rem);
}
.theme-option-description {
    display: block;
    margin-top: 0.2rem;
    color: color-mix(in srgb, var(--md-on-surface) 82%, var(--md-surface));
    font-size: 0.75rem;
    line-height: 1.35;
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
