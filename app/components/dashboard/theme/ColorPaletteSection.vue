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
                    Theme colors
                </h2>
                <p class="supporting-text mt-1">
                    Customize the main colors used throughout the app. Changes
                    apply to this color mode only.
                </p>
            </div>
            <label class="palette-toggle">
                <span>Custom colors</span>
                <input
                    type="checkbox"
                    :checked="overrides.colors?.enabled ?? false"
                    @change="togglePaletteOverrides"
                />
                <span class="palette-toggle-track" aria-hidden="true">
                    <span class="palette-toggle-thumb" />
                </span>
            </label>
        </div>

        <div class="color-workspace">
            <div class="color-list" aria-label="Theme color categories">
                <section
                    v-for="group in visibleColorGroups"
                    :key="group.label"
                >
                    <h3 class="color-list-heading">{{ group.label }}</h3>
                    <button
                        v-for="color in group.colors"
                        :key="color.key"
                        type="button"
                        class="color-list-item"
                        :class="{ active: color.key === activeColorKey }"
                        :aria-pressed="color.key === activeColorKey"
                        @click="activeColorKey = color.key"
                    >
                        <span
                            class="color-list-swatch"
                            :style="{ backgroundColor: displayColor(color) }"
                            aria-hidden="true"
                        />
                        <span class="color-list-label">{{ color.label }}</span>
                        <span class="color-list-value">
                            {{ displayColor(color) || 'Theme default' }}
                        </span>
                        <UIcon
                            :name="chevronIcon"
                            class="h-4 w-4 shrink-0"
                            aria-hidden="true"
                        />
                    </button>
                </section>
            </div>

            <section
                class="color-editor"
                aria-labelledby="active-color-heading"
            >
                <header class="color-editor-header">
                    <span
                        class="color-editor-swatch"
                        :style="{ backgroundColor: activeColorValue }"
                        aria-hidden="true"
                    />
                    <div class="min-w-0">
                        <h3 id="active-color-heading" class="color-editor-title">
                            {{ activeColor.label }}
                        </h3>
                        <p class="color-editor-group">{{ activeGroupLabel }}</p>
                    </div>
                </header>

                <div class="color-editor-body">
                    <div class="color-picker-block">
                        <span class="field-label">Color</span>
                        <UColorPicker
                            v-bind="paletteColorPickerProps"
                            :ui="colorPickerUi"
                            :disabled="!colorsEnabled"
                            :model-value="activeColorValue || undefined"
                            :aria-label="`${activeColor.label} color picker`"
                            class="palette-editor-picker"
                            @update:model-value="setActiveColorValue"
                        />
                    </div>

                    <div class="color-fields">
                        <label class="color-field color-field-wide">
                            <span class="field-label">Hex</span>
                            <div class="color-hex-row">
                                <input
                                    class="color-hex-input"
                                    type="text"
                                    placeholder="#RRGGBB"
                                    :value="
                                        colorsEnabled
                                            ? localHex[activeColor.key]
                                            : activeColorValue
                                    "
                                    :disabled="!colorsEnabled"
                                    :aria-label="`${activeColor.label} hex color`"
                                    @input="updateActiveHex"
                                />
                                <UButton
                                    v-bind="copyButtonProps"
                                    class="shrink-0"
                                    :disabled="!colorsEnabled || !activeColorValue"
                                    :aria-label="`Copy ${activeColor.label}`"
                                    :title="`Copy ${activeColor.label}`"
                                    @click="copyColor(activeColor.key)"
                                />
                            </div>
                        </label>

                        <fieldset class="rgb-fields" :disabled="!colorsEnabled">
                            <legend class="field-label">RGB</legend>
                            <label v-for="(channel, index) in ['R', 'G', 'B']" :key="channel">
                                <span>{{ channel }}</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="255"
                                    :value="activeRgb[index]"
                                    :aria-label="`${activeColor.label} ${channel}`"
                                    @change="setRgbChannel(index, $event)"
                                />
                            </label>
                        </fieldset>
                    </div>

                    <div class="color-presets">
                        <span class="field-label">Quick colors</span>
                        <div class="color-preset-row">
                            <button
                                v-for="preset in quickColors"
                                :key="preset"
                                type="button"
                                class="color-preset"
                                :class="{ active: preset.toLowerCase() === activeColorValue.toLowerCase() }"
                                :style="{
                                    backgroundColor: preset,
                                    color: contrastingTextColor(preset),
                                }"
                                :disabled="!colorsEnabled"
                                :aria-label="`Use ${preset}`"
                                @click="setActiveColorValue(preset)"
                            >
                                <UIcon
                                    v-if="preset.toLowerCase() === activeColorValue.toLowerCase()"
                                    :name="checkIcon"
                                    class="h-4 w-4"
                                />
                            </button>
                        </div>
                    </div>

                    <div class="color-preview" :style="previewStyle">
                        <span class="field-label">Preview</span>
                        <div class="preview-canvas">
                            <div class="preview-actions">
                                <button type="button" class="preview-button filled">
                                    Primary action
                                </button>
                                <button type="button" class="preview-button outlined">
                                    Secondary
                                </button>
                            </div>
                            <div class="preview-active-item">
                                <span aria-hidden="true" />
                                Active item
                            </div>
                            <div class="preview-panel">
                                <strong>Example panel</strong>
                                <span class="preview-primary-text">Primary text</span>
                                <span class="preview-secondary-text">Secondary text</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <div class="flex justify-center">
            <button
                type="button"
                class="advanced-colors-toggle"
                :aria-expanded="showAdvanced"
                @click="toggleAdvancedColors"
            >
                {{
                    showAdvanced
                        ? 'Hide advanced colors'
                        : 'Show advanced colors'
                }}
            </button>
        </div>
    </section>
</template>

<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useClipboard } from '@vueuse/core';
import { isBrowser } from '~/utils/env';
import type { ColorKey } from './types';
import {
    COLOR_TOKEN_ALIASES,
    COLOR_TOKEN_REGISTRY,
} from '~/theme/_shared/design-token-registry';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;

interface PaletteColorControl {
    key: ColorKey;
    label: string;
    linkedKeys?: ColorKey[];
    contrastKey?: ColorKey;
}

interface PaletteColorGroup {
    label: string;
    colors: PaletteColorControl[];
}

const showAdvanced = ref(false);
const activeColorKey = ref<ColorKey>('primary');

const basicColorGroups: PaletteColorGroup[] = [
    {
        label: 'Accent',
        colors: [
            {
                key: 'primary',
                label: 'Primary accent',
                contrastKey: 'onPrimary',
            },
            {
                key: 'primaryContainer',
                label: 'Accent surface',
                contrastKey: 'onPrimaryContainer',
            },
        ],
    },
    {
        label: 'Backgrounds & Text',
        colors: [
            { key: 'surface', label: 'App background' },
            {
                key: 'surfaceContainerLow',
                label: 'Panel background',
                linkedKeys: ['surfaceContainer'],
            },
            {
                key: 'surfaceContainerHigh',
                label: 'Elevated background',
                linkedKeys: ['surfaceContainerHighest'],
            },
            { key: 'onSurface', label: 'Primary text' },
            { key: 'onSurfaceVariant', label: 'Muted text' },
        ],
    },
    {
        label: 'Structure & States',
        colors: [
            {
                key: 'borderColor',
                label: 'Borders',
                linkedKeys: ['outlineVariant'],
            },
            { key: 'outline', label: 'Outline color' },
            { key: 'surfaceHover', label: 'Hover surface' },
            { key: 'surfaceActive', label: 'Pressed / selected surface' },
        ],
    },
    {
        label: 'Status',
        colors: [
            { key: 'error', label: 'Error' },
            { key: 'success', label: 'Success' },
            { key: 'warning', label: 'Warning' },
        ],
    },
];

const advancedColorGroups: PaletteColorGroup[] = [
    {
        label: 'Advanced Accent States',
        colors: [
            { key: 'onPrimary', label: 'Text on primary' },
            { key: 'onPrimaryContainer', label: 'Text on accent surface' },
            { key: 'primaryHover', label: 'Primary hover' },
            { key: 'primaryActive', label: 'Primary pressed' },
        ],
    },
    {
        label: 'Advanced Surface Roles',
        colors: [
            {
                key: 'surfaceContainerLowest',
                label: 'Surface container lowest',
            },
            { key: 'surfaceContainerLow', label: 'Surface container low' },
            { key: 'surfaceContainer', label: 'Surface container' },
            { key: 'surfaceContainerHigh', label: 'Surface container high' },
            {
                key: 'surfaceContainerHighest',
                label: 'Surface container highest',
            },
            { key: 'surfaceVariant', label: 'Surface Variant' },
            { key: 'inverseSurface', label: 'Inverse Surface' },
            { key: 'inverseOnSurface', label: 'Inverse On Surface' },
        ],
    },
    {
        label: 'Advanced Borders',
        colors: [
            { key: 'outlineVariant', label: 'Outline Variant' },
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
        label: 'Advanced Error Colors',
        colors: [
            { key: 'onError', label: 'Text on error' },
            { key: 'errorContainer', label: 'Error container' },
            { key: 'onErrorContainer', label: 'Text on error container' },
            { key: 'errorHover', label: 'Error hover' },
            { key: 'errorActive', label: 'Error pressed' },
        ],
    },
    {
        label: 'Info Colors',
        colors: [
            { key: 'info', label: 'Info' },
            { key: 'infoHover', label: 'Info hover' },
            { key: 'infoActive', label: 'Info pressed' },
        ],
    },
];

const visibleColorGroups = computed(() =>
    showAdvanced.value
        ? [...basicColorGroups, ...advancedColorGroups]
        : basicColorGroups
);

const allColorGroups = [...basicColorGroups, ...advancedColorGroups];
const activeColor = computed(
    () =>
        allColorGroups
            .flatMap((group) => group.colors)
            .find((color) => color.key === activeColorKey.value) ??
        basicColorGroups[0]!.colors[0]!
);
const activeGroupLabel = computed(
    () =>
        allColorGroups.find((group) =>
            group.colors.some((color) => color.key === activeColorKey.value)
        )?.label ?? 'Theme color'
);
const colorsEnabled = computed(
    () => overrides.value.colors?.enabled ?? false
);
const quickColors = [
    '#7c5cff',
    '#3478f6',
    '#18b8c9',
    '#35b978',
    '#f5b82e',
    '#f58231',
    '#ef4444',
    '#e83e78',
];

const allColorKeys = [
    ...new Set(
        [...basicColorGroups, ...advancedColorGroups].flatMap((group) =>
            group.colors.flatMap((color) => [
                color.key,
                ...(color.linkedKeys ?? []),
                ...(color.contrastKey ? [color.contrastKey] : []),
            ])
        )
    ),
];

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
const colorPickerUi = {
    selector: '!h-48 !w-48',
    track: '!h-48',
};

const copyButtonOverride = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.theme.copy-color',
    isNuxtUI: true,
});
const copyIcon = useIcon('ui.copy');
const chevronIcon = useIcon('ui.chevron.right').value;
const checkIcon = useIcon('ui.check').value;
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

function getCurrentTokenColor(key: ColorKey): string {
    const cssVariables = [
        colorCssVarMap[key],
        ...(COLOR_TOKEN_ALIASES[key] ?? []),
    ].filter((value): value is string => Boolean(value));
    for (const cssVariable of cssVariables) {
        const color = getCurrentThemeColor(cssVariable);
        if (color) return color;
    }
    return '';
}

function displayColor(control: PaletteColorControl): string {
    const customized = overrides.value.colors?.[control.key];
    if (
        colorsEnabled.value &&
        typeof customized === 'string' &&
        isValidHex(customized)
    ) {
        return customized;
    }
    return getCurrentTokenColor(control.key);
}

const activeColorValue = computed(() => displayColor(activeColor.value));
const activeRgb = computed(() => hexToRgb(activeColorValue.value));
const previewStyle = computed(() => {
    const color = activeColorValue.value || '#3478f6';
    return {
        '--preview-color': color,
        '--preview-on-color': contrastingTextColor(color),
    };
});

function togglePaletteOverrides() {
    const currentlyEnabled = overrides.value.colors?.enabled ?? false;

    if (!currentlyEnabled) {
        // Enabling: Initialize with current theme colors
        const initialColors: Partial<Record<ColorKey, string>> & {
            enabled: boolean;
        } = { enabled: true };
        for (const key of allColorKeys) {
            const savedColor = overrides.value.colors?.[key];
            const color =
                typeof savedColor === 'string' && savedColor.length > 0
                    ? savedColor
                    : getCurrentTokenColor(key);
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

function contrastingTextColor(color: string): '#000000' | '#ffffff' {
    const hex = color.slice(1);
    const expanded =
        hex.length === 3 || hex.length === 4
            ? hex
                  .slice(0, 3)
                  .split('')
                  .map((part) => part + part)
                  .join('')
            : hex.slice(0, 6);
    const channels = [0, 2, 4].map((offset) =>
        Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255
    );
    const luminance = channels
        .map((channel) =>
            channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4
        )
        .reduce(
            (total, channel, index) =>
                total + channel * [0.2126, 0.7152, 0.0722][index]!,
            0
        );
    return luminance > 0.179 ? '#000000' : '#ffffff';
}

function setColor(control: PaletteColorControl, color: string) {
    const colors: Partial<Record<ColorKey, string>> = {
        [control.key]: color,
    };
    for (const linkedKey of control.linkedKeys ?? []) {
        colors[linkedKey] = color;
    }
    if (control.contrastKey) {
        colors[control.contrastKey] = contrastingTextColor(color);
    }
    set({ colors });
}

function setActiveColorValue(color?: string) {
    if (!color || !colorsEnabled.value) return;
    const normalized = ensureHash(color).toLowerCase();
    if (!isValidHex(normalized)) return;
    localHex[activeColor.value.key] = normalized;
    setColor(activeColor.value, normalized);
}

function updateActiveHex(event: Event) {
    localHex[activeColor.value.key] = String(
        (event.currentTarget as HTMLInputElement).value ?? ''
    );
    onHexInput(activeColor.value);
}

function hexToRgb(color: string): [number, number, number] {
    if (!isValidHex(color)) return [0, 0, 0];
    const hex = color.slice(1);
    const expanded =
        hex.length === 3 || hex.length === 4
            ? hex
                  .slice(0, 3)
                  .split('')
                  .map((part) => part + part)
                  .join('')
            : hex.slice(0, 6);
    return [0, 2, 4].map((offset) =>
        Number.parseInt(expanded.slice(offset, offset + 2), 16)
    ) as [number, number, number];
}

function setRgbChannel(index: number, event: Event) {
    if (!colorsEnabled.value) return;
    const input = event.currentTarget as HTMLInputElement;
    const channels = [...activeRgb.value] as [number, number, number];
    channels[index] = Math.min(
        255,
        Math.max(0, Number.parseInt(input.value, 10) || 0)
    );
    const color = `#${channels
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`;
    setActiveColorValue(color);
}

function toggleAdvancedColors() {
    showAdvanced.value = !showAdvanced.value;
    if (
        !showAdvanced.value &&
        advancedColorGroups.some((group) =>
            group.colors.some((color) => color.key === activeColorKey.value)
        )
    ) {
        activeColorKey.value = 'primary';
    }
}

function onHexInput(control: PaletteColorControl) {
    const raw = localHex[control.key];
    if (!raw) return;
    const candidate = ensureHash(raw.trim());
    if (isValidHex(candidate)) {
        setColor(control, candidate.toLowerCase());
    }
}

const { copy: copyToClipboard } = useClipboard({ legacy: true });

async function copyColor(key: ColorKey) {
    const val = overrides.value.colors?.[key] || '';
    if (!val || !val.startsWith('#')) return;
    try {
        await copyToClipboard(val);
        if (import.meta.dev) {
            console.log('[ColorPaletteSection] Copied color:', val);
        }
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
#dashboard-theme-palette-section {
    width: 100%;
    max-width: 74rem;
    margin-inline: auto;
    --theme-editor-accent: var(--md-primary);
    --theme-editor-on-accent: var(--md-on-primary);
    --theme-editor-accent-container: var(--md-primary-container);
    --theme-editor-on-accent-container: var(--md-on-primary-container);
    --theme-editor-subtle: var(
        --md-surface-container-low,
        var(--md-surface)
    );
    --theme-editor-border: var(
        --md-outline-variant,
        var(--md-border-color)
    );
}
#dashboard-theme-palette-section .dashboard-section-title {
    font-size: 1.25rem;
    font-weight: 650;
}
#dashboard-theme-palette-section > div:first-child .supporting-text {
    font-size: 0.8125rem;
}
.palette-toggle {
    position: relative;
    display: flex;
    min-height: 2.25rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    color: var(--md-on-surface);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    user-select: none;
}
.palette-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
}
.palette-toggle-track {
    position: relative;
    display: block;
    width: 2.4rem;
    height: 1.35rem;
    background: var(--theme-editor-border);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: 999px;
    transition: background-color var(--app-motion-duration-fast, 120ms)
        var(--app-motion-easing-standard, ease);
}
.palette-toggle-thumb {
    position: absolute;
    top: 50%;
    left: 0.16rem;
    width: 0.9rem;
    height: 0.9rem;
    background: var(--md-on-primary);
    border-radius: 50%;
    transform: translateY(-50%);
    transition: left var(--app-motion-duration-fast, 120ms)
        var(--app-motion-easing-standard, ease);
}
.palette-toggle input:checked + .palette-toggle-track {
    background: var(--theme-editor-accent);
}
.palette-toggle input:checked + .palette-toggle-track .palette-toggle-thumb {
    left: 1.18rem;
}
.palette-toggle input:focus-visible + .palette-toggle-track {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--theme-editor-accent));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
.color-workspace {
    display: grid;
    min-width: 0;
    gap: 1.25rem;
    padding-top: 0.25rem;
    border-top: var(--md-border-width) solid var(--theme-editor-border);
}
.color-list,
.color-editor {
    min-width: 0;
    color: var(--md-on-surface);
    background: transparent;
    border: 0;
    border-radius: 0;
}
.color-list section + section {
    margin-top: 0.8rem;
}
.color-list-heading {
    margin: 0 0.65rem;
    padding: 0.7rem 0 0.45rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: transparent;
    border-bottom: var(--md-border-width-subtle) solid
        var(--theme-editor-border);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}
.color-list-item {
    display: grid;
    width: 100%;
    min-height: 2.8rem;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.65rem;
    padding: 0.45rem 0.65rem;
    color: var(--md-on-surface);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--md-border-radius-small);
    cursor: pointer;
}
.color-list-item:hover {
    background: var(--theme-editor-subtle);
}
.color-list-item.active {
    color: var(--theme-editor-on-accent-container);
    background: var(--theme-editor-accent-container);
    box-shadow: inset var(--md-border-width-strong) 0 0
        var(--theme-editor-accent);
}
.color-list-item:focus-visible {
    position: relative;
    z-index: 1;
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--theme-editor-accent));
    outline-offset: calc(-1 * var(--app-focus-ring-width, 2px));
}
.color-list-swatch,
.color-editor-swatch {
    display: block;
    width: 1.35rem;
    height: 1.35rem;
    background-color: var(--md-surface-container-high);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--md-on-surface) 18%, transparent);
}
.color-list-label {
    min-width: 0;
    overflow: hidden;
    font-size: 0.875rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.color-list-value {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    text-transform: uppercase;
}
.color-editor {
    align-self: start;
    padding: 0.55rem 0;
}
.color-editor-header {
    display: flex;
    min-height: auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.8rem 0.35rem;
    background: transparent;
    border-bottom: 0;
}
.color-editor-swatch {
    width: 1.8rem;
    height: 1.8rem;
}
.color-editor-title {
    overflow: hidden;
    font-size: 1.0625rem;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.color-editor-group {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.color-editor-body {
    display: grid;
    min-width: 0;
    gap: 0.85rem 1.25rem;
    padding: 0.75rem 0.8rem;
}
.color-picker-block,
.color-fields,
.color-presets,
.color-preview {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.55rem;
}
.palette-editor-picker {
    max-width: 100%;
}
.field-label {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}
.color-hex-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.45rem;
}
.color-hex-input,
.rgb-fields input {
    width: 100%;
    min-width: 0;
    min-height: 2.25rem;
    padding: 0.4rem 0.55rem;
    color: var(--md-on-surface) !important;
    background: var(--theme-editor-subtle) !important;
    border: var(--md-border-width) solid var(--theme-editor-border) !important;
    border-radius: var(--md-border-radius-small);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--md-on-surface) 3%, transparent);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
}
.color-hex-input:focus-visible,
.rgb-fields input:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--theme-editor-accent));
    outline-offset: var(--app-focus-ring-offset, 1px);
    border-color: var(--theme-editor-accent) !important;
}
.rgb-fields {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.45rem;
    margin-top: 0.8rem;
    padding: 0;
    border: 0;
}
.rgb-fields legend {
    grid-column: 1 / -1;
    margin-bottom: 0.1rem;
}
.rgb-fields label {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.25rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.64rem;
}
.color-preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
}
.color-preset {
    display: grid;
    width: 1.75rem;
    height: 1.75rem;
    place-items: center;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small);
    cursor: pointer;
}
.color-preset:hover,
.color-preset.active {
    outline: 2px solid var(--theme-editor-accent);
    outline-offset: 2px;
}
.color-preset:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
.advanced-colors-toggle {
    min-height: 2.35rem;
    padding: 0.4rem 0.7rem;
    color: var(--md-on-surface) !important;
    background: var(--md-surface) !important;
    border: var(--md-border-width) solid var(--theme-editor-border) !important;
}
.advanced-colors-toggle:hover {
    color: var(--md-on-surface) !important;
    background: var(
        --md-surface-hover,
        var(--md-surface-container-high, var(--md-surface))
    ) !important;
    border-color: var(--md-primary) !important;
}
.color-preview {
    padding-top: 0.8rem;
    background: transparent;
    border: 0;
    border-top: var(--md-border-width) solid var(--theme-editor-border);
    border-radius: 0;
}
.preview-canvas {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.75rem;
    background: var(--theme-editor-subtle);
    border: var(--md-border-width) solid var(--theme-editor-border);
    border-radius: var(--md-border-radius-small);
}
.preview-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
}
.preview-button {
    min-width: 6.5rem;
    padding: 0.5rem 0.7rem;
    border: var(--md-border-width) solid var(--preview-color);
    border-radius: var(--md-border-radius-small);
}
.preview-button.filled {
    color: var(--preview-on-color);
    background: var(--preview-color);
}
.preview-button.outlined {
    color: var(--preview-color);
    background: var(--md-surface);
}
.preview-panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--theme-editor-border);
    border-radius: var(--md-border-radius-small);
}
.preview-primary-text {
    color: var(--md-on-surface);
    font-size: 0.72rem;
}
.preview-secondary-text {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.7rem;
}
.preview-active-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--md-on-surface);
    font-size: 0.75rem;
    font-weight: 600;
}
.preview-active-item > span {
    width: 0.65rem;
    height: 0.65rem;
    background: var(--preview-color);
    border-radius: 50%;
}
@media (max-width: 520px) {
    .color-list-value {
        display: none;
    }
    .color-editor-body {
        padding: 0.75rem;
    }
}
@media (min-width: 760px) {
    .color-editor-body {
        grid-template-columns: auto minmax(12rem, 1fr);
        align-items: start;
    }
    .color-presets,
    .color-preview {
        grid-column: 1 / -1;
    }
}
@media (min-width: 980px) {
    .color-workspace {
        grid-template-columns: minmax(18rem, 0.88fr) minmax(22rem, 1.12fr);
        align-items: start;
    }
    .color-editor {
        position: sticky;
        top: 0.75rem;
        padding-left: 1.25rem;
        border-left: var(--md-border-width) solid var(--theme-editor-border);
    }
}
</style>
