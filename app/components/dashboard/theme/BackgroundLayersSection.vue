<template>
    <div class="space-y-12">
        <!-- Content Background Layer 1 -->
        <DashboardBackgroundLayerEditor
            title="Content Layer 1"
            description="Primary pattern beneath UI chrome. Size slider disabled when Fit is enabled."
            section-id="content-layer1"
            :url="contentBg1Url"
            :opacity="local.contentBg1Opacity"
            :size-px="local.contentBg1SizePx"
            :repeat="contentBg1Repeat"
            :fit="contentBg1Fit"
            :color="contentBg1Color"
            :preview-style="contentBg1PreviewStyle"
            :presets="presetsContent1"
            :bg-enabled="bgEnabled"
            empty-label="None"
            :preset-button-props="presetButtonProps"
            :remove-layer-button-props="removeLayerButtonProps"
            :repeat-button-props="repeatButtonProps"
            :color-picker-props="backgroundColorPickerProps"
            :hex-input-props="hexInputProps"
            :copy-button-props="copyButtonProps"
            @update:opacity="(v: number) => { local.contentBg1Opacity = v; commitOpacity('contentBg1Opacity', v); }"
            @update:size-px="(v: number) => { local.contentBg1SizePx = v; commitSize('contentBg1SizePx', v); }"
            @update:repeat="(v: 'repeat' | 'no-repeat') => set({ backgrounds: { content: { base: { repeat: v } } } })"
            @update:fit="(v: boolean) => set({ backgrounds: { content: { base: { fit: v } } } })"
            @update:color="(c: string) => set({ backgrounds: { content: { base: { color: c } } } })"
            @upload="(file: File) => handleLayerUpload(file, 'contentBg1')"
            @remove="removeLayer('contentBg1')"
            @apply-preset="(src: string, opacity: number) => applyPreset('contentBg1', src, opacity)"
        />

        <!-- Content Background Layer 2 -->
        <DashboardBackgroundLayerEditor
            title="Content Layer 2"
            description="Optional overlay pattern. Lower opacity recommended for subtle texture."
            section-id="content-layer2"
            :url="contentBg2Url"
            :opacity="local.contentBg2Opacity"
            :size-px="local.contentBg2SizePx"
            :repeat="contentBg2Repeat"
            :fit="contentBg2Fit"
            :color="contentBg2Color"
            :preview-style="contentBg2PreviewStyle"
            :presets="presetsContent2"
            :bg-enabled="bgEnabled"
            empty-label="Disabled"
            :preset-button-props="presetButtonProps"
            :remove-layer-button-props="removeLayerButtonProps"
            :repeat-button-props="repeatButtonProps"
            :color-picker-props="backgroundColorPickerProps"
            :hex-input-props="hexInputProps"
            :copy-button-props="copyButtonProps"
            @update:opacity="(v: number) => { local.contentBg2Opacity = v; commitOpacity('contentBg2Opacity', v); }"
            @update:size-px="(v: number) => { local.contentBg2SizePx = v; commitSize('contentBg2SizePx', v); }"
            @update:repeat="(v: 'repeat' | 'no-repeat') => set({ backgrounds: { content: { overlay: { repeat: v } } } })"
            @update:fit="(v: boolean) => set({ backgrounds: { content: { overlay: { fit: v } } } })"
            @update:color="(c: string) => set({ backgrounds: { content: { overlay: { color: c } } } })"
            @upload="(file: File) => handleLayerUpload(file, 'contentBg2')"
            @remove="removeLayer('contentBg2')"
            @apply-preset="(src: string, opacity: number) => applyPreset('contentBg2', src, opacity)"
        />

        <!-- Sidebar Background -->
        <DashboardBackgroundLayerEditor
            title="Sidebar Background"
            description="Applies to navigation rail / project tree area."
            section-id="sidebar"
            :url="sidebarBgUrl"
            :opacity="local.sidebarBgOpacity"
            :size-px="local.sidebarBgSizePx"
            :repeat="sidebarRepeat"
            :fit="sidebarBgFit"
            :color="sidebarBgColor"
            :preview-style="sidebarBgPreviewStyle"
            :presets="presetsSidebar"
            :bg-enabled="bgEnabled"
            empty-label="None"
            :preset-button-props="presetButtonProps"
            :remove-layer-button-props="removeLayerButtonProps"
            :repeat-button-props="repeatButtonProps"
            :color-picker-props="backgroundColorPickerProps"
            :hex-input-props="hexInputProps"
            :copy-button-props="copyButtonProps"
            @update:opacity="(v: number) => { local.sidebarBgOpacity = v; commitOpacity('sidebarBgOpacity', v); }"
            @update:size-px="(v: number) => { local.sidebarBgSizePx = v; commitSize('sidebarBgSizePx', v); }"
            @update:repeat="(v: 'repeat' | 'no-repeat') => set({ backgrounds: { sidebar: { repeat: v } } })"
            @update:fit="(v: boolean) => set({ backgrounds: { sidebar: { fit: v } } })"
            @update:color="(c: string) => set({ backgrounds: { sidebar: { color: c } } } })"
            @upload="(file: File) => handleLayerUpload(file, 'sidebarBg')"
            @remove="removeLayer('sidebarBg')"
            @apply-preset="(src: string, opacity: number) => applyPreset('sidebarBg', src, opacity)"
        />
    </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, watch, onBeforeUnmount } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useDebounceFn } from '@vueuse/core';
import { isBrowser } from '~/utils/env';
import { createOrRefFile, getFileBlob } from '~/db/files';
import { ALLOWED_IMAGE_TYPES, validateImageMagicNumber } from './types';
import type { BackgroundPreset } from './types';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;
const activeMode = themeApi.activeMode;

// Computed helpers for cleaner bindings
const bgEnabled = computed(() => overrides.value.backgrounds?.enabled ?? false);
const contentBg1Url = computed(() => overrides.value.backgrounds?.content?.base?.url || null);
const contentBg1Repeat = computed(() => overrides.value.backgrounds?.content?.base?.repeat || 'repeat');
const contentBg1Fit = computed(() => overrides.value.backgrounds?.content?.base?.fit ?? false);
const contentBg1Color = computed(() => overrides.value.backgrounds?.content?.base?.color || '');
const contentBg2Url = computed(() => overrides.value.backgrounds?.content?.overlay?.url || null);
const contentBg2Repeat = computed(() => overrides.value.backgrounds?.content?.overlay?.repeat || 'repeat');
const contentBg2Fit = computed(() => overrides.value.backgrounds?.content?.overlay?.fit ?? false);
const contentBg2Color = computed(() => overrides.value.backgrounds?.content?.overlay?.color || '');
const sidebarBgUrl = computed(() => overrides.value.backgrounds?.sidebar?.url || null);
const sidebarRepeat = computed(() => overrides.value.backgrounds?.sidebar?.repeat || 'repeat');
const sidebarBgFit = computed(() => overrides.value.backgrounds?.sidebar?.fit ?? false);
const sidebarBgColor = computed(() => overrides.value.backgrounds?.sidebar?.color || '');

// Local mutable copy for debounced slider interactions
const local = reactive({
    contentBg1Opacity: overrides.value.backgrounds?.content?.base?.opacity || 0,
    contentBg2Opacity: overrides.value.backgrounds?.content?.overlay?.opacity || 0,
    sidebarBgOpacity: overrides.value.backgrounds?.sidebar?.opacity || 0,
    contentBg1SizePx: overrides.value.backgrounds?.content?.base?.sizePx || 240,
    contentBg2SizePx: overrides.value.backgrounds?.content?.overlay?.sizePx || 240,
    sidebarBgSizePx: overrides.value.backgrounds?.sidebar?.sizePx || 240,
});

// Theme overrides for buttons/inputs
const presetButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.preset',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const removeLayerButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.remove-layer',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const repeatButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.repeat',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const backgroundColorPickerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'color-picker',
        context: 'dashboard',
        identifier: 'dashboard.theme.background-picker',
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
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        ...(overrides.value as any),
    };
});

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.copy-color',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'ghost' as const,
        icon: useIcon('ui.copy').value,
        square: true,
        ...(overrides.value as any),
    };
});

// Debounce helpers for sliders
const commitOpacity = useDebounceFn(
    (key: 'contentBg1Opacity' | 'contentBg2Opacity' | 'sidebarBgOpacity', v: number) => {
        if (key === 'contentBg1Opacity') {
            set({ backgrounds: { content: { base: { opacity: v } } } });
        } else if (key === 'contentBg2Opacity') {
            set({ backgrounds: { content: { overlay: { opacity: v } } } });
        } else if (key === 'sidebarBgOpacity') {
            set({ backgrounds: { sidebar: { opacity: v } } });
        }
    },
    70
);

const commitSize = useDebounceFn(
    (key: 'contentBg1SizePx' | 'contentBg2SizePx' | 'sidebarBgSizePx', v: number) => {
        if (key === 'contentBg1SizePx') {
            set({ backgrounds: { content: { base: { sizePx: v } } } });
        } else if (key === 'contentBg2SizePx') {
            set({ backgrounds: { content: { overlay: { sizePx: v } } } });
        } else if (key === 'sidebarBgSizePx') {
            set({ backgrounds: { sidebar: { sizePx: v } } });
        }
    },
    70
);

function removeLayer(which: 'contentBg1' | 'contentBg2' | 'sidebarBg') {
    if (which === 'contentBg1') {
        set({ backgrounds: { content: { base: { url: null, opacity: 0 } } } });
    } else if (which === 'contentBg2') {
        set({ backgrounds: { content: { overlay: { url: null, opacity: 0 } } } });
    } else if (which === 'sidebarBg') {
        set({ backgrounds: { sidebar: { url: null, opacity: 0 } } });
    }
}

const presetsContent1: BackgroundPreset[] = [
    { label: 'Default', src: '/bg-repeat.v2.webp', opacity: 0.08 },
];
const presetsContent2: BackgroundPreset[] = [
    { label: 'Default', src: '/bg-repeat-2.v2.webp', opacity: 0.125 },
];
const presetsSidebar: BackgroundPreset[] = [
    { label: 'Default', src: '/sidebar-repeater.v2.webp', opacity: 0.1 },
];

function applyPreset(which: 'contentBg1' | 'contentBg2' | 'sidebarBg', src: string, opacity: number) {
    if (which === 'contentBg1')
        set({ backgrounds: { content: { base: { url: src, opacity } } } });
    else if (which === 'contentBg2')
        set({ backgrounds: { content: { overlay: { url: src, opacity } } } });
    else if (which === 'sidebarBg')
        set({ backgrounds: { sidebar: { url: src, opacity } } });
}

// Cache of resolved object URLs for internal-file tokens
const internalUrlCache = new Map<string, string>();
const objectUrls = new Set<string>();
// Initialize immediately to avoid null checks
const abortController = ref<AbortController>(new AbortController());

function registerObjectUrl(u: string) {
    objectUrls.add(u);
}

function revokeAll() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.clear();
}

async function resolveInternalPath(v: string | null): Promise<string | null> {
    if (!v) return null;
    if (!v.startsWith('internal-file://')) return v;
    const hash = v.slice('internal-file://'.length);
    if (internalUrlCache.has(hash)) return internalUrlCache.get(hash)!;
    
    // Check if aborted (no null check needed now)
    if (abortController.value.signal.aborted) return null;
    
    try {
        const blob = await getFileBlob(hash);
        if (!blob || abortController.value.signal.aborted) return null;
        const u = URL.createObjectURL(blob);
        internalUrlCache.set(hash, u);
        registerObjectUrl(u);
        return u;
    } catch {
        return null;
    }
}

function getCssVarUrl(cssVar: string): string | null {
    if (!isBrowser()) return null;
    const computed = getComputedStyle(document.documentElement);
    const value = computed.getPropertyValue(cssVar).trim();
    if (!value) return null;
    const m = value.match(/url\((['"]?)(.*?)\1\)/);
    const raw = m?.[2];
    if (!raw) return null;
    try {
        const u = new URL(raw, window.location.origin);
        return u.pathname + u.search + u.hash;
    } catch {
        return raw;
    }
}

// Reactive resolved URLs
const resolvedContentBg1 = ref<string | null>(null);
const resolvedContentBg2 = ref<string | null>(null);
const resolvedSidebarBg = ref<string | null>(null);

async function refreshResolved() {
    const o1 = overrides.value.backgrounds?.content?.base?.url || null;
    const r1 = await resolveInternalPath(o1);
    resolvedContentBg1.value = r1 || getCssVarUrl('--app-content-bg-1');

    const o2 = overrides.value.backgrounds?.content?.overlay?.url || null;
    const r2 = await resolveInternalPath(o2);
    resolvedContentBg2.value = r2 || getCssVarUrl('--app-content-bg-2');

    const os = overrides.value.backgrounds?.sidebar?.url || null;
    const rs = await resolveInternalPath(os);
    resolvedSidebarBg.value = rs || getCssVarUrl('--app-sidebar-bg-1');
}

watch(
    () => [
        overrides.value.backgrounds?.content?.base?.url,
        overrides.value.backgrounds?.content?.overlay?.url,
        overrides.value.backgrounds?.sidebar?.url,
    ],
    () => {
        refreshResolved();
    },
    { immediate: true }
);

// Revoke ObjectURLs when switching modes to prevent leak
watch(activeMode, () => {
    revokeAll();
    internalUrlCache.clear();
    refreshResolved();
});

// Preview styles
const contentBg1PreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.content?.base?.fit;
    const repeatEnabled = overrides.value.backgrounds?.content?.base?.repeat === 'repeat' && !fit;
    
    return {
        backgroundImage: resolvedContentBg1.value ? `url(${resolvedContentBg1.value})` : 'none',
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: fit ? 'cover' : repeatEnabled ? '32px 32px' : 'contain',
        backgroundPosition: 'center',
    } as const;
});

const contentBg2PreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.content?.overlay?.fit;
    const repeatEnabled = overrides.value.backgrounds?.content?.overlay?.repeat === 'repeat' && !fit;
    
    return {
        backgroundImage: resolvedContentBg2.value ? `url(${resolvedContentBg2.value})` : 'none',
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: fit ? 'cover' : repeatEnabled ? '32px 32px' : 'contain',
        backgroundPosition: 'center',
    } as const;
});

const sidebarBgPreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.sidebar?.fit;
    const repeatEnabled = overrides.value.backgrounds?.sidebar?.repeat === 'repeat' && !fit;
    
    return {
        backgroundImage: resolvedSidebarBg.value ? `url(${resolvedSidebarBg.value})` : 'none',
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: fit ? 'cover' : repeatEnabled ? '32px 32px' : 'contain',
        backgroundPosition: 'center',
    } as const;
});

// File upload handler with security validation
async function handleLayerUpload(file: File, which: 'contentBg1' | 'contentBg2' | 'sidebarBg') {
    try {
        // Strict MIME type check - type predicate for const array
        const isAllowedType = (type: string): type is typeof ALLOWED_IMAGE_TYPES[number] => {
            return ALLOWED_IMAGE_TYPES.some(allowed => allowed === type);
        };
        
        if (!isAllowedType(file.type)) {
            console.error('[BackgroundLayersSection] Invalid image type:', file.type);
            return;
        }
        
        // Size check
        if (file.size > 2 * 1024 * 1024) {
            console.error('[BackgroundLayersSection] Image too large:', file.size);
            return;
        }
        
        // Magic number validation
        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        if (!validateImageMagicNumber(header)) {
            console.error('[BackgroundLayersSection] File format mismatch');
            return;
        }
        
        // Persist via file store
        const meta = await createOrRefFile(file, file.name || 'upload');
        const token = `internal-file://${meta.hash}`;
        
        if (which === 'contentBg1')
            set({ backgrounds: { content: { base: { url: token } } } });
        else if (which === 'contentBg2')
            set({ backgrounds: { content: { overlay: { url: token } } } });
        else if (which === 'sidebarBg')
            set({ backgrounds: { sidebar: { url: token } } });
            
        console.log('[BackgroundLayersSection] Image saved:', meta.hash.slice(0, 8));
    } catch (e: any) {
        console.error('[BackgroundLayersSection] Upload failed:', e?.message);
    }
}

// Lifecycle - abort pending operations on unmount
onBeforeUnmount(() => {
    abortController.value.abort();
    revokeAll();
});

// Sync local sliders when overrides change
watch(
    overrides,
    (o) => {
        if (!o) return;
        local.contentBg1Opacity = o.backgrounds?.content?.base?.opacity || 0;
        local.contentBg2Opacity = o.backgrounds?.content?.overlay?.opacity || 0;
        local.sidebarBgOpacity = o.backgrounds?.sidebar?.opacity || 0;
        local.contentBg1SizePx = o.backgrounds?.content?.base?.sizePx || 240;
        local.contentBg2SizePx = o.backgrounds?.content?.overlay?.sizePx || 240;
        local.sidebarBgSizePx = o.backgrounds?.sidebar?.sizePx || 240;
    },
    { deep: true }
);
</script>
