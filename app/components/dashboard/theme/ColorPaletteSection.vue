<template>
    <section
        id="dashboard-theme-palette-section"
        class="section-card space-y-4"
        role="group"
        aria-label="Theme colors"
    >
        <div class="flex flex-wrap items-center justify-between gap-x-3">
            <p class="supporting-text text-xs">Changes apply to this color mode only.</p>
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
            <section class="color-editor" aria-label="Color editor">
                <div class="color-token-field">
                    <label class="field-label" for="dashboard-color-token">Color token</label>
                    <USelect
                        id="dashboard-color-token"
                        v-model="activeColorKey"
                        :aria-describedby="activeColor.description ? 'dashboard-color-token-description' : undefined"
                        :items="colorOptions"
                        :content="{ align: 'start', sideOffset: 4, collisionPadding: 8 }"
                        :ui="{ content: 'w-[calc(var(--reka-select-trigger-width)/var(--app-ui-zoom,1))] data-[state=open]:animate-none! data-[state=closed]:animate-none!' }"
                        :trailing-icon="chevronIcon"
                        color="neutral"
                        class="color-token-select w-full"
                    >
                        <template #leading>
                            <span
                                class="color-token-swatch"
                                :style="{ backgroundColor: activeColorValue }"
                                aria-hidden="true"
                            />
                        </template>
                    </USelect>
                    <p v-if="activeColor.description" id="dashboard-color-token-description" class="supporting-text text-xs">
                        {{ activeColor.description }}
                        <template v-if="activeColor.hint && !showAdvanced"> {{ activeColor.hint }}</template>
                    </p>
                </div>
                <div class="color-editor-body">
                    <div class="color-picker-block">
                        <span class="field-label">Color</span>
                        <UColorPicker
                            v-bind="paletteColorPickerProps"
                            :ui="colorPickerUi"
                            :key="activeColorKey"
                            :throttle="50"
                            :disabled="!colorsEnabled"
                            :model-value="activeRgbHex || undefined"
                            :aria-label="`${activeColor.label} color picker`"
                            class="palette-editor-picker"
                            @pointerdown.capture="startPickerInteraction"
                            @update:model-value="updateFromPicker"
                        />
                    </div>

                    <div class="color-fields">
                        <div class="color-field color-field-wide">
                            <label for="dashboard-color-hex" class="field-label">Hex</label>
                            <div class="color-hex-row">
                                <input
                                    id="dashboard-color-hex"
                                    class="color-hex-input"
                                    type="text"
                                    placeholder="#RRGGBB"
                                    :value="hexDraft ?? activeHex"
                                    @blur="hexDraft = null"
                                    :disabled="!colorsEnabled"
                                    :aria-label="`${activeColor.label} hex color`"
                                    @input="updateActiveHex"
                                />
                                <UButton
                                    v-bind="copyButtonProps"
                                    class="shrink-0"
                                    :disabled="!activeColorValue"
                                    :aria-label="`Copy ${activeColor.label}`"
                                    :title="`Copy ${activeColor.label}`"
                                    @click="copyToClipboard(activeHex)"
                                />
                            </div>
                        </div>

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

                    <label v-if="activeColorKey === 'dialogBackdrop'" class="color-field">
                        <span class="field-label">Backdrop opacity · {{ backdropOpacity }}%</span>
                        <input type="range" min="0" max="100" aria-label="Backdrop opacity"
                            :value="backdropOpacity" :disabled="!colorsEnabled" @input="setBackdropOpacity" />
                    </label>
                    <div class="color-presets">
                        <span class="field-label">Quick colors</span>
                        <div class="color-preset-row">
                            <button
                                v-for="preset in quickColors"
                                :key="preset"
                                type="button"
                                class="color-preset"
                                :class="{ active: preset === activeRgbHex }"
                                :style="{
                                    backgroundColor: preset,
                                    color: contrastingTextColor(preset),
                                }"
                                :disabled="!colorsEnabled"
                                :aria-label="`Use ${preset}`"
                                @click="setActiveColorValue(preset)"
                            >
                                <UIcon
                                    v-if="preset === activeRgbHex"
                                    :name="checkIcon"
                                    class="h-4 w-4"
                                />
                            </button>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    class="advanced-colors-toggle"
                    :aria-pressed="showAdvanced"
                    @click="toggleAdvancedColors"
                >
                    {{ showAdvanced ? 'Hide advanced colors' : 'Show advanced colors' }}
                </button>
            </section>

            <ColorPalettePreview />
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useClipboard, useMutationObserver } from '@vueuse/core';
import { isBrowser } from '~/utils/env';
import type { ColorKey } from './types';
import ColorPalettePreview from './ColorPalettePreview.vue';
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
    description?: string;
    hint?: string;
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
                description: 'Colors primary actions such as Send and Save.',
                contrastKey: 'onPrimary',
            },
            {
                key: 'primaryContainer',
                label: 'Accent fill',
                description: 'Fills tinted highlights such as the selected heading in the document outline.',
                contrastKey: 'onPrimaryContainer',
            },
        ],
    },
    {
        label: 'Backgrounds & Text',
        colors: [
            {
                key: 'surface',
                label: 'App background',
                description: 'Sets the base background for chats, documents, and the document toolbar.',
            },
            {
                key: 'surfaceContainerLow',
                label: 'Panel background',
                description: 'Fills inset areas such as chat settings panels and attachment placeholders.',
                hint: 'Also updates the standard container background.',
                linkedKeys: ['surfaceContainer'],
            },
            {
                key: 'surfaceContainerHigh',
                label: 'Elevated background',
                description: 'Fills raised surfaces such as the tiles behind notification icons.',
                hint: 'Also updates the highest container shade.',
                linkedKeys: ['surfaceContainerHighest'],
            },
            {
                key: 'menuSurface',
                label: 'Menu & dialog background',
                description: 'Fills action menus, dropdowns, and dialogs such as Rename.',
            },
            {
                key: 'onSurface',
                label: 'Primary text',
                description: 'Colors main text such as headings, chat messages, and item names.',
            },
            {
                key: 'onSurfaceVariant',
                label: 'Muted text',
                description: 'Colors secondary details such as sidebar timestamps and helper text.',
            },
        ],
    },
    {
        label: 'Structure & States',
        colors: [
            {
                key: 'borderColor',
                label: 'Borders & dividers',
                description: 'Colors separators between sections and borders around panels and dialogs.',
                hint: 'Also sets subtle outlines.',
                linkedKeys: ['outlineVariant'],
            },
            {
                key: 'outline',
                label: 'Control outlines',
                description: 'Colors the edges of controls such as the chat composer and message editor.',
            },
            {
                key: 'surfaceHover',
                label: 'Hover surface',
                description: 'Fills hovered rows and controls and also colors chat bubbles in the Blank theme.',
            },
            {
                key: 'surfaceActive',
                label: 'Selected & pressed background',
                description: 'Fills pressed buttons and selected controls such as the project view toggle.',
            },
        ],
    },
    {
        label: 'Status',
        colors: [
            {
                key: 'error',
                label: 'Error',
                description: 'Colors error alerts and destructive actions such as Delete.',
            },
            {
                key: 'success',
                label: 'Success',
                description: 'Colors positive status indicators such as the dot for a connected provider.',
            },
            {
                key: 'warning',
                label: 'Warning',
                description: 'Colors caution indicators such as the icon beside a recovered project item.',
            },
        ],
    },
];

const advancedColorGroups: PaletteColorGroup[] = [
    {
        label: 'Advanced Accent States',
        colors: [
            { key: 'onPrimary', label: 'Text on primary' },
            { key: 'onPrimaryContainer', label: 'Text & icons on accent fill' },
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
                description: 'Fills the Files table header and related surfaces such as upload notices.',
            },
            { key: 'surfaceContainer', label: 'Surface container' },
            {
                key: 'surfaceContainerHighest',
                label: 'Surface container highest',
            },
            { key: 'surfaceVariant', label: 'Surface Variant' },
            { key: 'dialogBackdrop', label: 'Dialog backdrop' },
            { key: 'inverseSurface', label: 'Inverse Surface' },
            { key: 'inverseOnSurface', label: 'Text & icons on inverted background' },
        ],
    },
    {
        label: 'Advanced Borders',
        colors: [
            { key: 'focusRing', label: 'Keyboard focus ring' },
            { key: 'outlineVariant', label: 'Subtle outlines' },
        ],
    },
    {
        label: 'Secondary Colors',
        colors: [
            { key: 'secondary', label: 'Secondary' },
            { key: 'onSecondary', label: 'Text & icons on secondary' },
            { key: 'secondaryContainer', label: 'Secondary Container' },
            { key: 'onSecondaryContainer', label: 'Text & icons on secondary fill' },
        ],
    },
    {
        label: 'Tertiary Colors',
        colors: [
            { key: 'tertiary', label: 'Tertiary' },
            { key: 'onTertiary', label: 'Text & icons on tertiary' },
            { key: 'tertiaryContainer', label: 'Tertiary Container' },
            { key: 'onTertiaryContainer', label: 'Text & icons on tertiary fill' },
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

const allColorGroups = [...basicColorGroups, ...advancedColorGroups];
const colorOptions = computed(() =>
    (showAdvanced.value ? allColorGroups : basicColorGroups).map((group) => [
        { type: 'label' as const, label: group.label },
        ...group.colors.map(({ key, label }) => ({ value: key, label })),
    ])
);
const activeColor = computed(
    () =>
        allColorGroups
            .flatMap((group) => group.colors)
            .find((color) => color.key === activeColorKey.value) ??
        basicColorGroups[0]!.colors[0]!
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

const hexDraft = ref<string | null>(null);

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
    picker: 'grid! w-full grid-cols-[minmax(0,1fr)_auto] items-stretch!',
    selector: 'aspect-square h-auto! w-full!',
    track: 'h-auto!',
};

const copyButtonOverride = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.theme.copy-color',
    isNuxtUI: true,
});
const copyIcon = useIcon('ui.copy');
const chevronIcon = useIcon('ui.chevron.down');
const checkIcon = useIcon('ui.check');
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
        COLOR_TOKEN_REGISTRY[key],
        ...(COLOR_TOKEN_ALIASES[key] ?? []),
        ...(key === 'menuSurface' ? [COLOR_TOKEN_REGISTRY.surface] : []),
    ].filter((value): value is string => Boolean(value));
    for (const cssVariable of cssVariables) {
        const color = getCurrentThemeColor(cssVariable);
        if (color) return color;
    }
    return '';
}

const themeColor = ref('');
function readThemeColor() {
    themeColor.value = getCurrentTokenColor(activeColorKey.value);
}
onMounted(readThemeColor);
watch(activeColorKey, readThemeColor);
useMutationObserver(() => isBrowser() ? document.documentElement : null, readThemeColor, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
});

const activeColorValue = computed(() => {
    const saved = overrides.value.colors?.[activeColorKey.value];
    return colorsEnabled.value && saved && isValidHex(saved) ? saved : themeColor.value;
});
const activeRgbHex = computed(() => expandHex(activeColorValue.value).slice(0, 7));
const activeHex = computed(() => activeColorKey.value === 'dialogBackdrop' ? activeRgbHex.value : activeColorValue.value);
const activeRgb = computed(() => hexToRgb(activeRgbHex.value));
watch([activeColorKey, colorsEnabled], () => { hexDraft.value = null; });

function togglePaletteOverrides() {
    set({ colors: { enabled: !colorsEnabled.value } });
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
    const channels = hexToRgb(color).map(channel => channel / 255);
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
    if (!showAdvanced.value) {
        for (const linkedKey of control.linkedKeys ?? []) {
            colors[linkedKey] = color;
        }
        if (control.contrastKey) {
            colors[control.contrastKey] = contrastingTextColor(color);
        }
    }
    set({ colors });
}

function setActiveColorValue(color?: string) {
    if (!color || !colorsEnabled.value) return;
    const normalized = ensureHash(color).toLowerCase();
    if (!isValidHex(normalized)) return;
    const next = activeColorKey.value === 'dialogBackdrop'
        ? expandHex(normalized).slice(0, 7) + backdropAlpha.value
        : normalized;
    setColor(activeColor.value, next);
}

// Nuxt UI's picker echoes rounded HSL values after programmatic changes.
// Accept those updates only while a user is actually dragging the picker.
let pickerInteracting = false;
let pickerReleaseTimer: ReturnType<typeof setTimeout> | undefined;
watch(activeColorKey, () => { pickerInteracting = false; });
function startPickerInteraction() {
    clearTimeout(pickerReleaseTimer);
    pickerInteracting = true;
}
function endPickerInteraction() {
    if (!pickerInteracting) return;
    // The picker throttles its final update by 50ms after pointer release.
    pickerReleaseTimer = setTimeout(() => { pickerInteracting = false; }, 150);
}
function updateFromPicker(color?: string) {
    if (pickerInteracting) setActiveColorValue(color);
}
onMounted(() => {
    window.addEventListener('pointerup', endPickerInteraction);
    window.addEventListener('pointercancel', endPickerInteraction);
});
onUnmounted(() => {
    clearTimeout(pickerReleaseTimer);
    window.removeEventListener('pointerup', endPickerInteraction);
    window.removeEventListener('pointercancel', endPickerInteraction);
});

function updateActiveHex(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    hexDraft.value = value;
    const color = ensureHash(value.trim()).toLowerCase();
    if (activeColorKey.value === 'dialogBackdrop' && color.length !== 4 && color.length !== 7) return;
    setActiveColorValue(color);
}

const backdropAlpha = computed(() => expandHex(activeColorValue.value).slice(7) || 'ff');
const backdropOpacity = computed(() => Math.round(parseInt(backdropAlpha.value, 16) * 100 / 255));
function setBackdropOpacity(event: Event) {
    const percent = (event.currentTarget as HTMLInputElement).valueAsNumber;
    const alpha = Math.round(percent * 255 / 100).toString(16).padStart(2, '0');
    setColor(activeColor.value, activeRgbHex.value + alpha);
}

function expandHex(color: string): string {
    if (color.length === 4 || color.length === 5) {
        return '#' + Array.from(color.slice(1), digit => digit + digit).join('').toLowerCase();
    }
    return color.toLowerCase();
}

function hexToRgb(color: string): [number, number, number] {
    if (!isValidHex(color)) return [0, 0, 0];
    const rgb = expandHex(color);
    return [1, 3, 5].map(offset => parseInt(rgb.slice(offset, offset + 2), 16)) as [number, number, number];
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

const { copy: copyToClipboard } = useClipboard({ legacy: true });
</script>

<style scoped>
#dashboard-theme-palette-section {
    width: 100%;
    max-width: 74rem;
    margin-inline: auto;
    container-type: inline-size;
    --theme-editor-accent: var(--md-primary);
    --theme-editor-subtle: var(
        --md-surface-container-low,
        var(--md-surface)
    );
    --theme-editor-border: var(
        --md-outline-variant,
        var(--md-border-color)
    );
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
    align-items: start;
    padding-top: 0.75rem;
    border-top: var(--md-border-width) solid var(--theme-editor-border);
}
.color-editor,
.color-editor-body,
.color-token-field {
    display: grid;
    min-width: 0;
    gap: 0.65rem;
}
.color-token-field {
    gap: 0.35rem;
}
.color-token-swatch {
    display: block;
    width: 0.95rem;
    height: 0.95rem;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small);
}
.color-picker-block,
.color-fields,
.color-presets {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.55rem;
}
.palette-editor-picker {
    width: min(100%, 11rem);
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
    justify-self: start;
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
@container (min-width: 35rem) {
    .color-workspace {
        grid-template-columns: minmax(12rem, 1fr) min(62%, 26rem);
    }
    .color-editor {
        padding-inline-end: 1.25rem;
        border-inline-end: var(--md-border-width) solid var(--theme-editor-border);
    }
}
</style>
