<template>
    <section
        id="dashboard-theme-palette-section"
        class="section-card space-y-4"
        role="group"
        aria-labelledby="theme-section-palette"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 id="theme-section-palette" class="dashboard-section-title">
                    Semantic color tokens
                </h2>
                <p class="supporting-text mt-1">
                    Override Material Design 3 roles for this mode. Components
                    consume these roles instead of page-specific colors.
                </p>
            </div>
            <label class="palette-toggle">
                <input
                    type="checkbox"
                    :checked="overrides.colors?.enabled ?? false"
                    @change="togglePaletteOverrides"
                />
                <span>Enable overrides</span>
            </label>
        </div>

        <div class="palette-groups">
            <div
                v-for="group in colorGroups"
                :key="group.label"
                class="palette-group"
            >
                <h3 class="palette-group-title">{{ group.label }}</h3>
                <div class="divide-y divide-[var(--md-outline-variant)]">
                    <div
                        v-for="color in group.colors"
                        :key="color.key"
                        class="palette-token-row"
                    >
                        <label class="min-w-0 flex-1 text-xs font-medium">
                            {{ color.label }}
                        </label>
                        <div class="flex items-center gap-1.5">
                            <UColorPicker
                                v-bind="paletteColorPickerProps"
                                :disabled="
                                    !(overrides.colors?.enabled ?? false)
                                "
                                :model-value="
                                    (overrides.colors?.enabled ?? false) &&
                                    String(
                                        overrides.colors?.[
                                            color.key as ColorKey
                                        ] || ''
                                    ).startsWith('#')
                                        ? overrides.colors?.[
                                              color.key as ColorKey
                                          ]
                                        : undefined
                                "
                                @update:model-value="
                                    (c: string | undefined) => {
                                        if (c)
                                            set({
                                                colors: {
                                                    [color.key as ColorKey]: c,
                                                },
                                            });
                                    }
                                "
                                :aria-label="`${color.label} color picker`"
                                class="scale-60 shrink-0"
                            />
                            <div class="flex items-center gap-1.5">
                                <UInput
                                    v-bind="hexInputProps"
                                    class="w-24 h-8"
                                    type="text"
                                    :placeholder="'#RRGGBB'"
                                    :model-value="
                                        localHex[color.key as ColorKey]
                                    "
                                    @update:model-value="
                                        (v) => {
                                            localHex[color.key as ColorKey] =
                                                String(v ?? '');
                                            onHexInput(color.key as ColorKey);
                                        }
                                    "
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
                                        !String(
                                            overrides.colors?.[
                                                color.key as ColorKey
                                            ] || ''
                                        ).startsWith('#')
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
const paletteColorPickerProps = computed(
    () => paletteColorPickerOverride.value || {}
);

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

<style scoped>
.palette-toggle {
    display: flex;
    min-height: 2.25rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    color: var(--md-on-surface);
    background: var(--md-surface-container-low);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    cursor: pointer;
    font-size: 0.72rem;
    user-select: none;
}
.palette-toggle input {
    accent-color: var(--md-primary);
}
.palette-groups {
    display: grid;
    gap: 0.75rem;
}
.palette-group {
    overflow: hidden;
    background: var(--md-surface-container-low);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.palette-group-title {
    padding: 0.6rem 0.75rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: var(--md-surface-container);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}
.palette-token-row {
    display: flex;
    min-width: 0;
    min-height: 3rem;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.7rem;
}
.palette-token-row > .flex {
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
}
@media (max-width: 480px) {
    .palette-token-row {
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 0.5rem;
    }
    .palette-token-row > .flex {
        width: 100%;
        justify-content: flex-start;
    }
}
@media (min-width: 860px) {
    .palette-groups {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
    }
}
</style>
