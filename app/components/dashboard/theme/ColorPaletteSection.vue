<template>
    <section
        id="dashboard-theme-palette-section"
        class="section-card space-y-4"
        role="group"
        aria-labelledby="theme-section-palette"
    >
        <h2
            id="theme-section-palette"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Color Palette
        </h2>
        <p class="supporting-text">
            Override Material Design 3 colors for this mode. Toggle off to use
            theme defaults.
        </p>
        <label class="flex items-center gap-2 cursor-pointer select-none">
            <input
                type="checkbox"
                :checked="overrides.colors?.enabled ?? false"
                @change="togglePaletteOverrides"
            />
            <span class="text-xs">Enable palette overrides</span>
        </label>

        <div
            v-for="group in colorGroups"
            :key="group.label"
            class="space-y-2 pt-2"
        >
            <h3 class="text-xs font-semibold opacity-70">
                {{ group.label }}
            </h3>
            <div class="space-y-3 pl-2">
                <div
                    v-for="color in group.colors"
                    :key="color.key"
                    class="flex items-start gap-2 flex-wrap sm:flex-nowrap sm:items-center"
                >
                    <label class="w-full sm:w-40 text-xs pt-2 sm:pt-0">{{
                        color.label
                    }}</label>
                    <div
                        class="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto"
                    >
                        <UColorPicker
                            v-bind="paletteColorPickerProps"
                            :disabled="!(overrides.colors?.enabled ?? false)"
                            :model-value="
                                (overrides.colors?.enabled ?? false) &&
                                String(overrides.colors?.[color.key as ColorKey] || '').startsWith('#')
                                    ? overrides.colors?.[color.key as ColorKey]
                                    : undefined
                            "
                            @update:model-value="(c: string | undefined) => { if (c) set({ colors: { [color.key as ColorKey]: c } }); }"
                            :aria-label="`${color.label} color picker`"
                            class="scale-60 origin-left shrink-0"
                        />
                        <!-- Hex input + copy button row -->
                        <div class="flex items-center gap-2 w-full sm:w-auto">
                            <UInput
                                v-bind="hexInputProps"
                                class="flex-1 sm:w-24 h-8"
                                type="text"
                                :placeholder="'#RRGGBB'"
                                :model-value="localHex[color.key as ColorKey]"
                                @update:model-value="(v) => { localHex[color.key as ColorKey] = String(v ?? ''); onHexInput(color.key as ColorKey); }"
                                :disabled="
                                    !(overrides.colors?.enabled ?? false)
                                "
                                :aria-label="`${color.label} hex color`"
                            />
                            <UButton
                                v-bind="copyButtonProps"
                                class="shrink-0"
                                :disabled="
                                    !(overrides.colors?.enabled ?? false) ||
                                    !String(overrides.colors?.[color.key as ColorKey] || '').startsWith('#')
                                "
                                :aria-label="`Copy ${color.label}`"
                                :title="`Copy ${color.label}`"
                                @click="copyColor(color.key as ColorKey)"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides, mergeThemeProps } from '~/composables/useThemeResolver';
import { useClipboard } from '@vueuse/core';
import { isBrowser } from '~/utils/env';
import type { ColorKey } from './types';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;

// Color groups for organized UI
const colorGroups = [
    {
        label: 'Primary Colors',
        colors: [
            { key: 'primary', label: 'Primary' },
            { key: 'onPrimary', label: 'On Primary' },
            { key: 'primaryContainer', label: 'Primary Container' },
            { key: 'onPrimaryContainer', label: 'On Primary Container' },
        ],
    },
    {
        label: 'Secondary Colors',
        colors: [
            { key: 'secondary', label: 'Secondary' },
            { key: 'onSecondary', label: 'On Secondary' },
            { key: 'secondaryContainer', label: 'Secondary Container' },
            { key: 'onSecondaryContainer', label: 'On Secondary Container' },
        ],
    },
    {
        label: 'Tertiary Colors',
        colors: [
            { key: 'tertiary', label: 'Tertiary' },
            { key: 'onTertiary', label: 'On Tertiary' },
            { key: 'tertiaryContainer', label: 'Tertiary Container' },
            { key: 'onTertiaryContainer', label: 'On Tertiary Container' },
        ],
    },
    {
        label: 'Error Colors',
        colors: [
            { key: 'error', label: 'Error' },
            { key: 'onError', label: 'On Error' },
            { key: 'errorContainer', label: 'Error Container' },
            { key: 'onErrorContainer', label: 'On Error Container' },
        ],
    },
    {
        label: 'Surface Colors',
        colors: [
            { key: 'surface', label: 'Surface' },
            { key: 'onSurface', label: 'On Surface' },
            { key: 'surfaceVariant', label: 'Surface Variant' },
            { key: 'onSurfaceVariant', label: 'On Surface Variant' },
            { key: 'inverseSurface', label: 'Inverse Surface' },
            { key: 'inverseOnSurface', label: 'Inverse On Surface' },
        ],
    },
    {
        label: 'Outline',
        colors: [
            { key: 'outline', label: 'Outline' },
            { key: 'outlineVariant', label: 'Outline Variant' },
        ],
    },
    {
        label: 'Semantic Colors',
        colors: [
            { key: 'success', label: 'Success' },
            { key: 'warning', label: 'Warning' },
        ],
    },
];

// Local hex inputs
const localHex: Record<ColorKey, string> = reactive({
    primary: String(overrides.value.colors?.primary || '').startsWith('#')
        ? String(overrides.value.colors?.primary)
        : '',
    onPrimary: String(overrides.value.colors?.onPrimary || '').startsWith('#')
        ? String(overrides.value.colors?.onPrimary)
        : '',
    primaryContainer: String(
        overrides.value.colors?.primaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.primaryContainer)
        : '',
    onPrimaryContainer: String(
        overrides.value.colors?.onPrimaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onPrimaryContainer)
        : '',
    secondary: String(overrides.value.colors?.secondary || '').startsWith('#')
        ? String(overrides.value.colors?.secondary)
        : '',
    onSecondary: String(overrides.value.colors?.onSecondary || '').startsWith(
        '#'
    )
        ? String(overrides.value.colors?.onSecondary)
        : '',
    secondaryContainer: String(
        overrides.value.colors?.secondaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.secondaryContainer)
        : '',
    onSecondaryContainer: String(
        overrides.value.colors?.onSecondaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onSecondaryContainer)
        : '',
    tertiary: String(overrides.value.colors?.tertiary || '').startsWith('#')
        ? String(overrides.value.colors?.tertiary)
        : '',
    onTertiary: String(overrides.value.colors?.onTertiary || '').startsWith('#')
        ? String(overrides.value.colors?.onTertiary)
        : '',
    tertiaryContainer: String(
        overrides.value.colors?.tertiaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.tertiaryContainer)
        : '',
    onTertiaryContainer: String(
        overrides.value.colors?.onTertiaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onTertiaryContainer)
        : '',
    error: String(overrides.value.colors?.error || '').startsWith('#')
        ? String(overrides.value.colors?.error)
        : '',
    onError: String(overrides.value.colors?.onError || '').startsWith('#')
        ? String(overrides.value.colors?.onError)
        : '',
    errorContainer: String(
        overrides.value.colors?.errorContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.errorContainer)
        : '',
    onErrorContainer: String(
        overrides.value.colors?.onErrorContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onErrorContainer)
        : '',
    surface: String(overrides.value.colors?.surface || '').startsWith('#')
        ? String(overrides.value.colors?.surface)
        : '',
    onSurface: String(overrides.value.colors?.onSurface || '').startsWith('#')
        ? String(overrides.value.colors?.onSurface)
        : '',
    surfaceVariant: String(
        overrides.value.colors?.surfaceVariant || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.surfaceVariant)
        : '',
    onSurfaceVariant: String(
        overrides.value.colors?.onSurfaceVariant || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onSurfaceVariant)
        : '',
    inverseSurface: String(
        overrides.value.colors?.inverseSurface || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.inverseSurface)
        : '',
    inverseOnSurface: String(
        overrides.value.colors?.inverseOnSurface || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.inverseOnSurface)
        : '',
    outline: String(overrides.value.colors?.outline || '').startsWith('#')
        ? String(overrides.value.colors?.outline)
        : '',
    outlineVariant: String(
        overrides.value.colors?.outlineVariant || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.outlineVariant)
        : '',
    success: String(overrides.value.colors?.success || '').startsWith('#')
        ? String(overrides.value.colors?.success)
        : '',
    warning: String(overrides.value.colors?.warning || '').startsWith('#')
        ? String(overrides.value.colors?.warning)
        : '',
});

// Theme overrides for UI components
const paletteColorPickerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'color-picker',
        context: 'dashboard',
        identifier: 'dashboard.theme.palette-picker',
        isNuxtUI: true,
    });
    return overrides.value || {};
});

const hexInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'dashboard',
        identifier: 'dashboard.theme.hex-input',
        isNuxtUI: true,
    });
    return mergeThemeProps({
        size: 'sm' as const,
        variant: 'outline' as const,
    }, overrides.value as any);
});

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.copy-color',
        isNuxtUI: true,
    });
    return mergeThemeProps({
        size: 'sm' as const,
        variant: 'ghost' as const,
        icon: useIcon('ui.copy').value,
        square: true,
    }, overrides.value as any);
});

// Helper to get current color from CSS variables (base theme)
function getCurrentThemeColor(cssVar: string): string {
    if (!isBrowser()) return '';
    const computed = getComputedStyle(document.documentElement);
    const value = computed.getPropertyValue(cssVar).trim();
    // Convert rgb(r, g, b) or rgb(r g b) to hex
    if (value.startsWith('rgb')) {
        const match = value.match(/rgb\((\d+)[,\s]+(\d+)[,\s]+(\d+)\)/);
        if (match && match[1] && match[2] && match[3]) {
            const r = parseInt(match[1], 10);
            const g = parseInt(match[2], 10);
            const b = parseInt(match[3], 10);
            return (
                '#' +
                ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
            );
        }
    }
    return value.startsWith('#') ? value : '';
}

function togglePaletteOverrides() {
    const currentlyEnabled = overrides.value.colors?.enabled ?? false;

    if (!currentlyEnabled) {
        // Enabling: Initialize with current theme colors
        const colorMap: Array<[string, string]> = [
            ['primary', '--md-primary'],
            ['onPrimary', '--md-on-primary'],
            ['primaryContainer', '--md-primary-container'],
            ['onPrimaryContainer', '--md-on-primary-container'],
            ['secondary', '--md-secondary'],
            ['onSecondary', '--md-on-secondary'],
            ['secondaryContainer', '--md-secondary-container'],
            ['onSecondaryContainer', '--md-on-secondary-container'],
            ['tertiary', '--md-tertiary'],
            ['onTertiary', '--md-on-tertiary'],
            ['tertiaryContainer', '--md-tertiary-container'],
            ['onTertiaryContainer', '--md-on-tertiary-container'],
            ['error', '--md-error'],
            ['onError', '--md-on-error'],
            ['errorContainer', '--md-error-container'],
            ['onErrorContainer', '--md-on-error-container'],
            ['surface', '--md-surface'],
            ['onSurface', '--md-on-surface'],
            ['surfaceVariant', '--md-surface-variant'],
            ['onSurfaceVariant', '--md-on-surface-variant'],
            ['inverseSurface', '--md-inverse-surface'],
            ['inverseOnSurface', '--md-inverse-on-surface'],
            ['outline', '--md-outline'],
            ['outlineVariant', '--md-outline-variant'],
            ['success', '--md-extended-color-success-color'],
            ['warning', '--md-extended-color-warning-color'],
        ];

        const initialColors: Partial<Record<ColorKey, string>> & {
            enabled: boolean;
        } = { enabled: true };
        for (const [key, cssVar] of colorMap) {
            const color = getCurrentThemeColor(cssVar);
            if (color) {
                initialColors[key as ColorKey] = color;
            }
        }

        set({ colors: initialColors });
    } else {
        // Disabling: Just toggle off
        set({ colors: { enabled: false } });
    }
}

// Hex handling
function isValidHex(v: string) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
        v
    );
}

function ensureHash(v: string) {
    return v.startsWith('#') ? v : `#${v}`;
}

function onHexInput(key: ColorKey) {
    const raw = localHex[key];
    if (!raw) return;
    const candidate = ensureHash(raw.trim());
    if (isValidHex(candidate)) {
        set({ colors: { [key]: candidate.toLowerCase() } });
    }
}

const { copy: copyToClipboard } = useClipboard({ legacy: true });

async function copyColor(key: ColorKey) {
    const val = overrides.value.colors?.[key] || '';
    if (!val || !val.startsWith('#')) return;
    try {
        await copyToClipboard(val);
        console.log('[ColorPaletteSection] Copied color:', val);
    } catch {
        console.error('[ColorPaletteSection] Copy failed');
    }
}

// Sync local hex when overrides change
watch(
    overrides,
    (o) => {
        if (!o?.colors) return;
        for (const key of Object.keys(localHex) as ColorKey[]) {
            const val = o.colors[key];
            if (val && val.startsWith('#')) {
                localHex[key] = val;
            }
        }
    },
    { deep: true }
);
</script>

<style scoped>
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
