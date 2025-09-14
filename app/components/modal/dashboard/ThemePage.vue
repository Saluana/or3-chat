<template>
    <!-- Root no longer forces full height or its own scroll; parent provides scroll container -->
    <div class="px-4 py-4 space-y-12 text-sm">
        <!-- Mode Toggle -->
        <section class="space-y-2">
            <div class="flex items-center justify-between">
                <h2 class="font-heading text-base uppercase tracking-wide">
                    Theme Mode
                </h2>
                <div class="flex gap-2 items-center">
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        :class="activeMode === 'light' ? 'active' : ''"
                        :disabled="activeMode === 'light'"
                        @click="switchMode('light')"
                        >Light</UButton
                    >
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        :class="activeMode === 'dark' ? 'active' : ''"
                        :disabled="activeMode === 'dark'"
                        @click="switchMode('dark')"
                        >Dark</UButton
                    >
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        @click="onResetCurrent"
                        :title="'Reset ' + activeMode + ' profile'"
                        >Reset {{ activeMode }}</UButton
                    >
                </div>
            </div>
            <p class="text-xs opacity-70">
                Each mode stores its own backgrounds & colors. Use Reset (mode)
                for just this profile or Reset All below for both.
            </p>
        </section>
        <!-- Custom Background Colors Master Toggle -->
        <section class="space-y-2">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Custom Background Colors
            </h2>
            <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    :checked="settings.customBgColorsEnabled"
                    @change="
                        set({
                            customBgColorsEnabled:
                                !settings.customBgColorsEnabled,
                        });
                        reapply();
                    "
                />
                <span class="text-xs"
                    >Enable custom background color overrides</span
                >
            </label>
            <p
                class="text-xs opacity-70"
                v-if="!settings.customBgColorsEnabled"
            >
                Disabled: system/theme background colors shown.
            </p>
            <p class="text-xs opacity-70" v-else>
                Enabled: custom values below override system backgrounds.
            </p>
        </section>
        <!-- Typography -->
        <section class="space-y-3">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Typography
            </h2>
            <div class="flex items-center gap-4">
                <label class="w-32">Base Font</label>
                <input
                    type="range"
                    min="14"
                    max="24"
                    :value="local.baseFontPx"
                    @input="onFontSizeRange($event)"
                    class="flex-1"
                />
                <span class="w-10 text-center tabular-nums"
                    >{{ local.baseFontPx }}px</span
                >
            </div>
            <label
                class="flex items-center gap-2 cursor-pointer select-none pt-2"
            >
                <input
                    type="checkbox"
                    :checked="settings.useSystemFont"
                    @change="set({ useSystemFont: !settings.useSystemFont })"
                />
                <span class="text-xs">Use system font for body & headings</span>
            </label>
        </section>

        <!-- Content Background Layer 1 -->
        <section class="space-y-4">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Content Layer 1
            </h2>
            <!-- Preview row -->
            <div class="flex items-center gap-3">
                <div
                    class="pattern-thumb"
                    :class="
                        !settings.contentBg1 || local.contentBg1Opacity === 0
                            ? 'opacity-30'
                            : ''
                    "
                    :style="{
                        backgroundImage: settings.contentBg1
                            ? `url(${settings.contentBg1})`
                            : 'none',
                        backgroundRepeat: settings.contentRepeat,
                    }"
                    aria-label="Content background layer 1 preview"
                />
                <span
                    class="text-xs truncate max-w-[160px]"
                    :title="displayName(settings.contentBg1)"
                >
                    {{
                        settings.contentBg1
                            ? displayName(settings.contentBg1)
                            : 'None'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    v-for="p in presetsContent1"
                    :key="p.src"
                    @click="applyPreset('contentBg1', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('contentBg1', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="removeLayer('contentBg1')"
                >
                    Remove
                </UButton>
                <label
                    class="border-2 shadow-none! drop-shadow-none! hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[var(--md-inverse-surface)] text-[var(--md-on-surface)] rounded-[3px] h-[32px] text-[16px] flex items-center justify-center px-2.5 cursor-pointer"
                >
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'contentBg1')"
                    />
                </label>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="toggleRepeat('contentRepeat')"
                >
                    Repeat:
                    {{ settings.contentRepeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="local.contentBg1Opacity"
                    @input="onOpacityRange($event, 'contentBg1Opacity')"
                    class="flex-1"
                />
                <span class="w-12 text-right tabular-nums">{{
                    local.contentBg1Opacity.toFixed(2)
                }}</span>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Fallback Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.contentBg1Color.startsWith('#')
                            ? settings.contentBg1Color
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ contentBg1Color: c })"
                    class="scale-75 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.contentBg1Color"
                        @input="onHexInput('contentBg1Color')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Content layer 1 fallback hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('contentBg1Color')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.contentBg1Color.startsWith('#')
                        "
                        aria-label="Copy content layer 1 color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Content Background Layer 2 -->
        <section class="space-y-4">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Content Layer 2
            </h2>
            <div class="flex items-center gap-3">
                <div
                    class="pattern-thumb"
                    :class="
                        !settings.contentBg2 || local.contentBg2Opacity === 0
                            ? 'opacity-30'
                            : ''
                    "
                    :style="{
                        backgroundImage: settings.contentBg2
                            ? `url(${settings.contentBg2})`
                            : 'none',
                        backgroundRepeat: settings.contentRepeat,
                    }"
                    aria-label="Content background layer 2 preview"
                />
                <span
                    class="text-xs truncate max-w-[160px]"
                    :title="displayName(settings.contentBg2)"
                >
                    {{
                        settings.contentBg2
                            ? displayName(settings.contentBg2)
                            : 'Disabled'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    v-for="p in presetsContent2"
                    :key="p.src"
                    @click="applyPreset('contentBg2', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('contentBg2', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="removeLayer('contentBg2')"
                >
                    Remove
                </UButton>
                <label
                    class="border-2 shadow-none! drop-shadow-none! hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[var(--md-inverse-surface)] text-[var(--md-on-surface)] rounded-[3px] h-[32px] text-[16px] flex items-center justify-center px-2.5 cursor-pointer"
                >
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'contentBg2')"
                    />
                </label>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="local.contentBg2Opacity"
                    @input="onOpacityRange($event, 'contentBg2Opacity')"
                    class="flex-1"
                />
                <span class="w-12 text-right tabular-nums">{{
                    local.contentBg2Opacity.toFixed(2)
                }}</span>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Fallback Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.contentBg2Color.startsWith('#')
                            ? settings.contentBg2Color
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ contentBg2Color: c })"
                    class="scale-75 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.contentBg2Color"
                        @input="onHexInput('contentBg2Color')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Content layer 2 fallback hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('contentBg2Color')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.contentBg2Color.startsWith('#')
                        "
                        aria-label="Copy content layer 2 color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Sidebar Background -->
        <section class="space-y-4">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Sidebar Background
            </h2>
            <div class="flex items-center gap-3">
                <div
                    class="pattern-thumb"
                    :class="
                        !settings.sidebarBg || local.sidebarBgOpacity === 0
                            ? 'opacity-30'
                            : ''
                    "
                    :style="{
                        backgroundImage: settings.sidebarBg
                            ? `url(${settings.sidebarBg})`
                            : 'none',
                        backgroundRepeat: settings.sidebarRepeat,
                    }"
                    aria-label="Sidebar background preview"
                />
                <span
                    class="text-xs truncate max-w-[160px]"
                    :title="displayName(settings.sidebarBg)"
                >
                    {{
                        settings.sidebarBg
                            ? displayName(settings.sidebarBg)
                            : 'None'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    v-for="p in presetsSidebar"
                    :key="p.src"
                    @click="applyPreset('sidebarBg', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('sidebarBg', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="removeLayer('sidebarBg')"
                >
                    Remove
                </UButton>
                <label
                    class="border-2 shadow-none! drop-shadow-none! hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[var(--md-inverse-surface)] text-[var(--md-on-surface)] rounded-[3px] h-[32px] text-[16px] flex items-center justify-center px-2.5 cursor-pointer"
                >
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'sidebarBg')"
                    />
                </label>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="toggleRepeat('sidebarRepeat')"
                >
                    Repeat:
                    {{ settings.sidebarRepeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="local.sidebarBgOpacity"
                    @input="onOpacityRange($event, 'sidebarBgOpacity')"
                    class="flex-1"
                />
                <span class="w-12 text-right tabular-nums">{{
                    local.sidebarBgOpacity.toFixed(2)
                }}</span>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Fallback Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.sidebarBgColor.startsWith('#')
                            ? settings.sidebarBgColor
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ sidebarBgColor: c })"
                    class="scale-75 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.sidebarBgColor"
                        @input="onHexInput('sidebarBgColor')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Sidebar fallback hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('sidebarBgColor')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.sidebarBgColor.startsWith('#')
                        "
                        aria-label="Copy sidebar color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Accessibility -->
        <section class="space-y-3">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Accessibility
            </h2>
            <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    :checked="settings.reducePatternsInHighContrast"
                    @change="toggleReduceHighContrast"
                />
                <span class="text-xs"
                    >Reduce pattern opacity in high contrast modes</span
                >
            </label>
        </section>

        <!-- Navigation Header -->
        <section class="space-y-4">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Navigation Header
            </h2>
            <div class="flex items-center gap-3 text-xs">
                <span class="opacity-70">Gradient:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="settings.showHeaderGradient"
                    @click="set({ showHeaderGradient: true })"
                    >Default</UButton
                >
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="!settings.showHeaderGradient"
                    @click="set({ showHeaderGradient: false })"
                    >Remove</UButton
                >
                <span class="opacity-60"
                    >Current:
                    {{
                        settings.showHeaderGradient ? 'Default' : 'Removed'
                    }}</span
                >
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Background Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.headerBgColor.startsWith('#')
                            ? settings.headerBgColor
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ headerBgColor: c })"
                    class="scale-75 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.headerBgColor"
                        @input="onHexInput('headerBgColor')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Header background hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('headerBgColor')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.headerBgColor.startsWith('#')
                        "
                        aria-label="Copy header color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Navigation Footer -->
        <section class="space-y-4">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Navigation Footer
            </h2>
            <div class="flex items-center gap-3 text-xs">
                <span class="opacity-70">Gradient:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="settings.showBottomBarGradient"
                    @click="set({ showBottomBarGradient: true })"
                    >Default</UButton
                >
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="!settings.showBottomBarGradient"
                    @click="set({ showBottomBarGradient: false })"
                    >Remove</UButton
                >
                <span class="opacity-60"
                    >Current:
                    {{
                        settings.showBottomBarGradient ? 'Default' : 'Removed'
                    }}</span
                >
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Background Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.bottomBarBgColor.startsWith('#')
                            ? settings.bottomBarBgColor
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ bottomBarBgColor: c })"
                    class="scale-75 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.bottomBarBgColor"
                        @input="onHexInput('bottomBarBgColor')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Bottom bar background hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('bottomBarBgColor')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.bottomBarBgColor.startsWith('#')
                        "
                        aria-label="Copy bottom bar color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Reset -->
        <section class="space-y-3">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Reset
            </h2>
            <UButton
                size="sm"
                variant="basic"
                class="retro-btn px-3 py-2 text-xs"
                @click="onResetAll"
            >
                Reset All
            </UButton>
        </section>
    </div>
</template>

<script setup lang="ts">
import { reactive, watch, onBeforeUnmount } from 'vue';
// Relative import (no alias friction inside /app)
import {
    useThemeSettings,
    DEFAULT_THEME_SETTINGS,
    type ThemeSettings,
} from '~/composables/useThemeSettings';
import type { Ref } from 'vue';

const themeApi = useThemeSettings();
const settings = themeApi.settings as Ref<ThemeSettings>; // active mode settings
const set = themeApi.set;
const reset = themeApi.reset; // resets active mode by default
const resetAll = themeApi.resetAll;
const reapply = themeApi.reapply;
const activeMode = themeApi.activeMode;
const switchMode = themeApi.switchMode;

// Local mutable copy for debounced slider interactions
const local = reactive({
    baseFontPx: settings.value.baseFontPx,
    contentBg1Opacity: settings.value.contentBg1Opacity,
    contentBg2Opacity: settings.value.contentBg2Opacity,
    sidebarBgOpacity: settings.value.sidebarBgOpacity,
});

// Local hex color text boxes (so user can type partial values without reverting)
const localHex = reactive({
    contentBg1Color: settings.value.contentBg1Color.startsWith('#')
        ? settings.value.contentBg1Color
        : '',
    contentBg2Color: settings.value.contentBg2Color.startsWith('#')
        ? settings.value.contentBg2Color
        : '',
    sidebarBgColor: settings.value.sidebarBgColor.startsWith('#')
        ? settings.value.sidebarBgColor
        : '',
    headerBgColor: settings.value.headerBgColor.startsWith('#')
        ? settings.value.headerBgColor
        : '',
    bottomBarBgColor: settings.value.bottomBarBgColor.startsWith('#')
        ? settings.value.bottomBarBgColor
        : '',
});

// Simple debounce helper
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
    let t: any;
    return (...args: any[]) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

const commitFontSize = debounce((v: number) => set({ baseFontPx: v }), 70);
const commitOpacity = debounce((key: keyof ThemeSettings, v: number) => {
    set({ [key]: v } as any);
}, 70);

function onFontSizeRange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    local.baseFontPx = v;
    commitFontSize(v);
}
function onOpacityRange(
    e: Event,
    key: 'contentBg1Opacity' | 'contentBg2Opacity' | 'sidebarBgOpacity'
) {
    const v = Number((e.target as HTMLInputElement).value);
    (local as any)[key] = v;
    commitOpacity(key, v);
}

function toggleRepeat(key: 'contentRepeat' | 'sidebarRepeat') {
    const current = (settings.value as any)[key];
    const next = current === 'repeat' ? 'no-repeat' : 'repeat';
    set({ [key]: next } as any);
}

function removeLayer(which: 'contentBg1' | 'contentBg2' | 'sidebarBg') {
    if (which === 'contentBg1') {
        set({ contentBg1: null, contentBg1Opacity: 0 });
    } else if (which === 'contentBg2') {
        set({ contentBg2: null, contentBg2Opacity: 0 });
    } else if (which === 'sidebarBg') {
        set({ sidebarBg: null, sidebarBgOpacity: 0 });
    }
}

function toggleReduceHighContrast() {
    set({
        reducePatternsInHighContrast:
            !settings.value.reducePatternsInHighContrast,
    });
    reapply();
}

const presetsContent1 = [
    { label: 'Default', src: '/bg-repeat.webp', opacity: 0.08 },
];
const presetsContent2 = [
    { label: 'Default', src: '/bg-repeat-2.webp', opacity: 0.125 },
];
const presetsSidebar = [
    { label: 'Default', src: '/sidebar-repeater.webp', opacity: 0.1 },
];

function applyPreset(
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg',
    src: string,
    opacity: number
) {
    if (which === 'contentBg1')
        set({ contentBg1: src, contentBg1Opacity: opacity });
    else if (which === 'contentBg2')
        set({ contentBg2: src, contentBg2Opacity: opacity });
    else if (which === 'sidebarBg')
        set({ sidebarBg: src, sidebarBgOpacity: opacity });
}

function displayName(path: string | null) {
    if (!path) return '';
    try {
        if (path.startsWith('blob:')) return 'Uploaded';
        const url = new URL(path, window.location.origin);
        return url.pathname.split('/').pop() || path;
    } catch {
        return path.split('/').pop() || path;
    }
}

function isPresetActive(
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg',
    src: string
) {
    return (settings.value as any)[which] === src ? 'active' : '';
}

// Object URL lifecycle tracking
const objectUrls = new Set<string>();
function registerObjectUrl(u: string) {
    objectUrls.add(u);
}
function revokeAll() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.clear();
}
onBeforeUnmount(revokeAll);

// Minimal notify (console only for now; integrate with existing toast system later)
function notify(title: string, description?: string) {
    // eslint-disable-next-line no-console
    console.warn('[theme-settings]', title, description || '');
}

function onUpload(ev: Event, which: 'contentBg1' | 'contentBg2' | 'sidebarBg') {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        notify('Invalid image type');
        input.value = '';
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        notify('Image too large', 'Max 2MB');
        input.value = '';
        return;
    }
    const url = URL.createObjectURL(file);
    registerObjectUrl(url);
    if (which === 'contentBg1') set({ contentBg1: url });
    else if (which === 'contentBg2') set({ contentBg2: url });
    else if (which === 'sidebarBg') set({ sidebarBg: url });
    input.value = '';
}

function onResetAll() {
    if (confirm('Reset BOTH light and dark theme settings to defaults?')) {
        resetAll();
    }
}

function onResetCurrent() {
    if (confirm(`Reset ${activeMode.value} theme settings to defaults?`)) {
        reset();
    }
}

// Hex handling helpers
function isValidHex(v: string) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
        v
    );
}
function ensureHash(v: string) {
    return v.startsWith('#') ? v : `#${v}`;
}
function onHexInput(key: keyof typeof localHex) {
    const raw = (localHex as any)[key];
    if (!raw) return; // allow clearing without committing
    const candidate = ensureHash(raw.trim());
    if (isValidHex(candidate)) {
        set({ [key]: candidate.toLowerCase() } as any);
    }
}
async function copyColor(key: keyof typeof localHex) {
    const val = (settings.value as any)[key];
    if (!val || !val.startsWith('#')) return;
    try {
        await navigator.clipboard.writeText(val);
        notify('Copied color', val);
    } catch {
        notify('Copy failed');
    }
}

// Keep local reactive sliders synced if external reset or future import occurs
watch(
    settings,
    (s) => {
        if (!s) return;
        local.baseFontPx = s.baseFontPx;
        local.contentBg1Opacity = s.contentBg1Opacity;
        local.contentBg2Opacity = s.contentBg2Opacity;
        local.sidebarBgOpacity = s.sidebarBgOpacity;
        // sync hex boxes (only show hex values)
        localHex.contentBg1Color = s.contentBg1Color.startsWith('#')
            ? s.contentBg1Color
            : '';
        localHex.contentBg2Color = s.contentBg2Color.startsWith('#')
            ? s.contentBg2Color
            : '';
        localHex.sidebarBgColor = s.sidebarBgColor.startsWith('#')
            ? s.sidebarBgColor
            : '';
        localHex.headerBgColor = s.headerBgColor.startsWith('#')
            ? s.headerBgColor
            : '';
        localHex.bottomBarBgColor = s.bottomBarBgColor.startsWith('#')
            ? s.bottomBarBgColor
            : '';
    },
    { deep: true }
);
</script>

<style scoped>
.pattern-thumb {
    width: 58px;
    height: 58px;
    border: 2px solid var(--md-inverse-surface);
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
    background-color: var(--md-surface-variant);
    background-size: 32px 32px;
    image-rendering: pixelated;
}

.retro-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.5rem; /* ~py-1 px-2 */
    font-size: 0.75rem; /* text-xs */
    font-weight: 500; /* font-medium */
    user-select: none;
    transition: background-color 120ms ease, color 120ms ease;
    border: 2px solid var(--md-inverse-surface);
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
    border-radius: 3px;
    background: var(--md-surface);
    line-height: 1;
}
.retro-chip:hover {
    background: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
}
.retro-chip:active {
    transform: translate(2px, 2px);
    box-shadow: 0 0 0 var(--md-inverse-surface);
}
.retro-chip.active {
    background: var(--md-primary-container);
    color: var(--md-on-primary-container);
}
.retro-chip:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}

.retro-input {
    height: 32px;
    padding: 0 6px;
    font-size: 12px;
    font-family: inherit;
    line-height: 1;
    border: 2px solid var(--md-inverse-surface);
    background: var(--md-surface);
    color: var(--md-on-surface);
    border-radius: 3px;
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
}
.retro-input:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}
.retro-btn-copy {
    height: 32px;
    padding: 0 8px;
    font-size: 10px;
    line-height: 1;
    border: 2px solid var(--md-inverse-surface);
    background: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
    border-radius: 3px;
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
    cursor: pointer;
}
.retro-btn-copy:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.retro-btn-copy:active:not(:disabled) {
    transform: translate(2px, 2px);
    box-shadow: 0 0 0 var(--md-inverse-surface);
}
.retro-btn-copy:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}
</style>
