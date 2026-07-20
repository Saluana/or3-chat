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
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useClipboard } from '@vueuse/core';
import { isBrowser } from '~/utils/env';
import type { ColorKey } from './types';
import { COLOR_TOKEN_REGISTRY } from '~/theme/_shared/design-token-registry';

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

const allColorKeys = colorGroups.flatMap((group) =>
    group.colors.map((color) => color.key as ColorKey)
);

const colorCssVarMap = COLOR_TOKEN_REGISTRY as Record<ColorKey, string>;

// Local hex inputs
const localHex: Record<ColorKey, string> = reactive(
    Object.fromEntries(
        allColorKeys.map((key) => {
            const value = String(overrides.value.colors?.[key] || '');
            return [key, value.startsWith('#') ? value : ''];
        })
    ) as Record<ColorKey, string>
);

// Theme overrides for UI components
const paletteColorPickerOverride = useThemeOverrides({
    component: 'color-picker',
    context: 'dashboard',
    identifier: 'dashboard.theme.palette-picker',
    isNuxtUI: true,
});
const paletteColorPickerProps = computed(() => paletteColorPickerOverride.value || {});

const hexInputOverride = useThemeOverrides({
    component: 'input',
    context: 'dashboard',
    identifier: 'dashboard.theme.hex-input',
    isNuxtUI: true,
});
const hexInputProps = computed(() => {
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        ...(hexInputOverride.value as any),
    };
});

const copyButtonOverride = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.theme.copy-color',
    isNuxtUI: true,
});
const copyIcon = useIcon('ui.copy');
const copyButtonProps = computed(() => {
    return {
        size: 'sm' as const,
        variant: 'ghost' as const,
        icon: copyIcon.value,
        square: true,
        ...(copyButtonOverride.value as any),
    };
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
        const initialColors: Partial<Record<ColorKey, string>> & {
            enabled: boolean;
        } = { enabled: true };
        for (const key of allColorKeys) {
            const cssVar = colorCssVarMap[key];
            if (!cssVar) continue;
            const color = getCurrentThemeColor(cssVar);
            if (color) {
                initialColors[key] = color;
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
