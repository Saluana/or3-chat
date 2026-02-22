<template>
    <div class="space-y-12">
        <DashboardBackgroundLayerEditor
            v-for="layer in layerEditors"
            :key="layer.key"
            :title="layer.title"
            :description="layer.description"
            :section-id="layer.sectionId"
            :url="layer.url"
            :opacity="layer.opacity"
            :size-px="layer.sizePx"
            :repeat="layer.repeat"
            :fit="layer.fit"
            :color="layer.color"
            :preview-style="layer.previewStyle"
            :presets="layer.presets"
            :bg-enabled="bgEnabled"
            :empty-label="layer.emptyLabel"
            :preset-button-props="presetButtonProps"
            :remove-layer-button-props="removeLayerButtonProps"
            :repeat-button-props="repeatButtonProps"
            :color-picker-props="backgroundColorPickerProps"
            :hex-input-props="hexInputProps"
            :copy-button-props="copyButtonProps"
            @update:opacity="(v: number) => onLayerOpacity(layer.key, v)"
            @update:size-px="(v: number) => onLayerSize(layer.key, v)"
            @update:repeat="(v: 'repeat' | 'no-repeat') => layer.onRepeat(v)"
            @update:fit="(v: boolean) => layer.onFit(v)"
            @update:color="(c: string) => layer.onColor(c)"
            @upload="(file: File) => handleLayerUpload(file, layer.key)"
            @remove="removeLayer(layer.key)"
            @apply-preset="(src: string, opacity: number) => applyPreset(layer.key, src, opacity)"
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
import { isAllowedImageType, validateImageMagicNumber } from './types';
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

type LayerKey = 'contentBg1' | 'contentBg2' | 'sidebarBg';
type OpacityLocalKey = 'contentBg1Opacity' | 'contentBg2Opacity' | 'sidebarBgOpacity';
type SizeLocalKey = 'contentBg1SizePx' | 'contentBg2SizePx' | 'sidebarBgSizePx';

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
    (key: OpacityLocalKey, v: number) => {
        const updater: Record<OpacityLocalKey, () => void> = {
            contentBg1Opacity: () =>
                set({ backgrounds: { content: { base: { opacity: v } } } }),
            contentBg2Opacity: () =>
                set({ backgrounds: { content: { overlay: { opacity: v } } } }),
            sidebarBgOpacity: () =>
                set({ backgrounds: { sidebar: { opacity: v } } }),
        };
        updater[key]();
    },
    70
);

const commitSize = useDebounceFn(
    (key: SizeLocalKey, v: number) => {
        const updater: Record<SizeLocalKey, () => void> = {
            contentBg1SizePx: () =>
                set({ backgrounds: { content: { base: { sizePx: v } } } }),
            contentBg2SizePx: () =>
                set({ backgrounds: { content: { overlay: { sizePx: v } } } }),
            sidebarBgSizePx: () =>
                set({ backgrounds: { sidebar: { sizePx: v } } }),
        };
        updater[key]();
    },
    70
);

function removeLayer(which: LayerKey) {
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

function applyPreset(which: LayerKey, src: string, opacity: number) {
    if (which === 'contentBg1')
        set({ backgrounds: { content: { base: { url: src, opacity } } } });
    else if (which === 'contentBg2')
        set({ backgrounds: { content: { overlay: { url: src, opacity } } } });
    else if (which === 'sidebarBg')
        set({ backgrounds: { sidebar: { url: src, opacity } } });
}

const layerLocalKeys: Record<
    LayerKey,
    { opacity: OpacityLocalKey; size: SizeLocalKey }
> = {
    contentBg1: { opacity: 'contentBg1Opacity', size: 'contentBg1SizePx' },
    contentBg2: { opacity: 'contentBg2Opacity', size: 'contentBg2SizePx' },
    sidebarBg: { opacity: 'sidebarBgOpacity', size: 'sidebarBgSizePx' },
};

function onLayerOpacity(layer: LayerKey, value: number) {
    const localKey = layerLocalKeys[layer].opacity;
    local[localKey] = value;
    commitOpacity(localKey, value);
}

function onLayerSize(layer: LayerKey, value: number) {
    const localKey = layerLocalKeys[layer].size;
    local[localKey] = value;
    commitSize(localKey, value);
}

const layerEditors = computed(() => [
    {
        key: 'contentBg1' as const,
        title: 'Content Layer 1',
        description:
            'Primary pattern beneath UI chrome. Size slider disabled when Fit is enabled.',
        sectionId: 'content-layer1',
        url: contentBg1Url.value,
        opacity: local.contentBg1Opacity,
        sizePx: local.contentBg1SizePx,
        repeat: contentBg1Repeat.value,
        fit: contentBg1Fit.value,
        color: contentBg1Color.value,
        previewStyle: contentBg1PreviewStyle.value,
        presets: presetsContent1,
        emptyLabel: 'None',
        onRepeat: (value: 'repeat' | 'no-repeat') =>
            set({ backgrounds: { content: { base: { repeat: value } } } }),
        onFit: (value: boolean) =>
            set({ backgrounds: { content: { base: { fit: value } } } }),
        onColor: (value: string) =>
            set({ backgrounds: { content: { base: { color: value } } } }),
    },
    {
        key: 'contentBg2' as const,
        title: 'Content Layer 2',
        description:
            'Optional overlay pattern. Lower opacity recommended for subtle texture.',
        sectionId: 'content-layer2',
        url: contentBg2Url.value,
        opacity: local.contentBg2Opacity,
        sizePx: local.contentBg2SizePx,
        repeat: contentBg2Repeat.value,
        fit: contentBg2Fit.value,
        color: contentBg2Color.value,
        previewStyle: contentBg2PreviewStyle.value,
        presets: presetsContent2,
        emptyLabel: 'Disabled',
        onRepeat: (value: 'repeat' | 'no-repeat') =>
            set({ backgrounds: { content: { overlay: { repeat: value } } } }),
        onFit: (value: boolean) =>
            set({ backgrounds: { content: { overlay: { fit: value } } } }),
        onColor: (value: string) =>
            set({ backgrounds: { content: { overlay: { color: value } } } }),
    },
    {
        key: 'sidebarBg' as const,
        title: 'Sidebar Background',
        description: 'Applies to navigation rail / project tree area.',
        sectionId: 'sidebar',
        url: sidebarBgUrl.value,
        opacity: local.sidebarBgOpacity,
        sizePx: local.sidebarBgSizePx,
        repeat: sidebarRepeat.value,
        fit: sidebarBgFit.value,
        color: sidebarBgColor.value,
        previewStyle: sidebarBgPreviewStyle.value,
        presets: presetsSidebar,
        emptyLabel: 'None',
        onRepeat: (value: 'repeat' | 'no-repeat') =>
            set({ backgrounds: { sidebar: { repeat: value } } }),
        onFit: (value: boolean) =>
            set({ backgrounds: { sidebar: { fit: value } } }),
        onColor: (value: string) =>
            set({ backgrounds: { sidebar: { color: value } } }),
    },
]);

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
        // Strict MIME type check using shared utility
        if (!isAllowedImageType(file.type)) {
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

// Sync local sliders when overrides change (targeted updates only)
// Note: We rely on the existing specific watchers (L351-360) for URL changes.
// This provides a fallback sync for slider values when the data structure changes.
watch(
    () => [
        overrides.value.backgrounds?.content?.base?.opacity,
        overrides.value.backgrounds?.content?.overlay?.opacity,
        overrides.value.backgrounds?.sidebar?.opacity,
        overrides.value.backgrounds?.content?.base?.sizePx,
        overrides.value.backgrounds?.content?.overlay?.sizePx,
        overrides.value.backgrounds?.sidebar?.sizePx,
    ],
    () => {
        const o = overrides.value;
        if (!o) return;
        local.contentBg1Opacity = o.backgrounds?.content?.base?.opacity || 0;
        local.contentBg2Opacity = o.backgrounds?.content?.overlay?.opacity || 0;
        local.sidebarBgOpacity = o.backgrounds?.sidebar?.opacity || 0;
        local.contentBg1SizePx = o.backgrounds?.content?.base?.sizePx || 240;
        local.contentBg2SizePx = o.backgrounds?.content?.overlay?.sizePx || 240;
        local.sidebarBgSizePx = o.backgrounds?.sidebar?.sizePx || 240;
    }
);
</script>
