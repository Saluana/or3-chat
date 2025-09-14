<template>
    <!-- Root no longer forces full height or its own scroll; parent provides scroll container -->
    <div class="px-4 py-4 space-y-12 text-sm">
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
                    v-for="p in presetsContent1"
                    :key="p.src"
                    @click="applyPreset('contentBg1', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('contentBg1', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton class="retro-chip" @click="removeLayer('contentBg1')">
                    Remove
                </UButton>
                <label class="retro-chip cursor-pointer">
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'contentBg1')"
                    />
                </label>
                <UButton
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
                <UButton class="retro-chip" @click="toggleLayer2()">
                    {{ settings.contentBg2 ? 'Disable' : 'Enable' }}
                </UButton>
                <template v-if="settings.contentBg2">
                    <span class="text-xs opacity-70">Presets:</span>
                    <UButton
                        v-for="p in presetsContent2"
                        :key="p.src"
                        @click="applyPreset('contentBg2', p.src, p.opacity)"
                        class="retro-chip"
                        :class="isPresetActive('contentBg2', p.src)"
                    >
                        {{ p.label }}
                    </UButton>
                    <label class="retro-chip cursor-pointer">
                        Upload
                        <input
                            type="file"
                            class="hidden"
                            accept="image/*"
                            @change="onUpload($event, 'contentBg2')"
                        />
                    </label>
                </template>
            </div>
            <div v-if="settings.contentBg2" class="flex items-center gap-4">
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
                    v-for="p in presetsSidebar"
                    :key="p.src"
                    @click="applyPreset('sidebarBg', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('sidebarBg', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton class="retro-chip" @click="removeLayer('sidebarBg')">
                    Remove
                </UButton>
                <label class="retro-chip cursor-pointer">
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'sidebarBg')"
                    />
                </label>
                <UButton
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

        <!-- Reset -->
        <section class="space-y-3">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Reset
            </h2>
            <UButton class="retro-btn px-3 py-2 text-xs" @click="onResetAll">
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
const settings = themeApi.settings as Ref<ThemeSettings>; // explicit ref typing
const set = themeApi.set;
const reset = themeApi.reset;
const reapply = themeApi.reapply;

// Local mutable copy for debounced slider interactions
const local = reactive({
    baseFontPx: settings.value.baseFontPx,
    contentBg1Opacity: settings.value.contentBg1Opacity,
    contentBg2Opacity: settings.value.contentBg2Opacity,
    sidebarBgOpacity: settings.value.sidebarBgOpacity,
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

function removeLayer(which: 'contentBg1' | 'sidebarBg') {
    if (which === 'contentBg1') {
        set({ contentBg1: null, contentBg1Opacity: 0 });
    } else if (which === 'sidebarBg') {
        set({ sidebarBg: null, sidebarBgOpacity: 0 });
    }
}

function toggleLayer2() {
    if (settings.value.contentBg2) {
        set({ contentBg2: null, contentBg2Opacity: 0 });
    } else {
        set({
            contentBg2: DEFAULT_THEME_SETTINGS.contentBg2,
            contentBg2Opacity: DEFAULT_THEME_SETTINGS.contentBg2Opacity,
        });
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
    { label: 'Default 1', src: '/bg-repeat.webp', opacity: 0.08 },
    { label: 'Alt 1', src: '/gradient-x.webp', opacity: 0.08 },
];
const presetsContent2 = [
    { label: 'Default 2', src: '/bg-repeat-2.webp', opacity: 0.125 },
    { label: 'Alt 2', src: '/gradient-x-sm.webp', opacity: 0.1 },
];
const presetsSidebar = [
    { label: 'Default', src: '/sidebar-repeater.webp', opacity: 0.1 },
    { label: 'Gradient', src: '/gradient-x.webp', opacity: 0.1 },
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
    if (confirm('Reset all theme settings to defaults?')) {
        reset();
        local.baseFontPx = DEFAULT_THEME_SETTINGS.baseFontPx;
        local.contentBg1Opacity = DEFAULT_THEME_SETTINGS.contentBg1Opacity;
        local.contentBg2Opacity = DEFAULT_THEME_SETTINGS.contentBg2Opacity;
        local.sidebarBgOpacity = DEFAULT_THEME_SETTINGS.sidebarBgOpacity;
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
    },
    { deep: true }
);
</script>

<style scoped>
.pattern-thumb {
    width: 42px;
    height: 42px;
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
</style>
