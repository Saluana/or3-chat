<template>
    <div class="p-4 space-y-8 text-sm">
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
        </section>

        <!-- Content Background Layer 1 -->
        <section class="space-y-4">
            <h2 class="font-heading text-base uppercase tracking-wide">
                Content Layer 1
            </h2>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <button
                    v-for="p in presetsContent1"
                    :key="p.src"
                    @click="applyPreset('contentBg1', p.src, p.opacity)"
                    class="retro-btn px-2 py-1 text-xs"
                >
                    {{ p.label }}
                </button>
                <button
                    class="retro-btn px-2 py-1 text-xs"
                    @click="removeLayer('contentBg1')"
                >
                    Remove
                </button>
                <label class="retro-btn px-2 py-1 text-xs cursor-pointer">
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'contentBg1')"
                    />
                </label>
                <button
                    class="retro-btn px-2 py-1 text-xs"
                    @click="toggleRepeat('contentRepeat')"
                >
                    Repeat:
                    {{ settings.contentRepeat === 'repeat' ? 'On' : 'Off' }}
                </button>
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
            <div class="flex flex-wrap gap-2 items-center">
                <button
                    class="retro-btn px-2 py-1 text-xs"
                    @click="toggleLayer2()"
                >
                    {{ settings.contentBg2 ? 'Disable' : 'Enable' }}
                </button>
                <template v-if="settings.contentBg2">
                    <span class="text-xs opacity-70">Presets:</span>
                    <button
                        v-for="p in presetsContent2"
                        :key="p.src"
                        @click="applyPreset('contentBg2', p.src, p.opacity)"
                        class="retro-btn px-2 py-1 text-xs"
                    >
                        {{ p.label }}
                    </button>
                    <label class="retro-btn px-2 py-1 text-xs cursor-pointer">
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
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <button
                    v-for="p in presetsSidebar"
                    :key="p.src"
                    @click="applyPreset('sidebarBg', p.src, p.opacity)"
                    class="retro-btn px-2 py-1 text-xs"
                >
                    {{ p.label }}
                </button>
                <button
                    class="retro-btn px-2 py-1 text-xs"
                    @click="removeLayer('sidebarBg')"
                >
                    Remove
                </button>
                <label class="retro-btn px-2 py-1 text-xs cursor-pointer">
                    Upload
                    <input
                        type="file"
                        class="hidden"
                        accept="image/*"
                        @change="onUpload($event, 'sidebarBg')"
                    />
                </label>
                <button
                    class="retro-btn px-2 py-1 text-xs"
                    @click="toggleRepeat('sidebarRepeat')"
                >
                    Repeat:
                    {{ settings.sidebarRepeat === 'repeat' ? 'On' : 'Off' }}
                </button>
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
            <button class="retro-btn px-3 py-2 text-xs" @click="onResetAll">
                Reset All
            </button>
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
