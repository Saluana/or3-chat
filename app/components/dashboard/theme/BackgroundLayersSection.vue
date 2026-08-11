<template>
    <section
        id="dashboard-theme-backgrounds-section"
        class="section-card background-studio"
        role="group"
        aria-labelledby="theme-section-backgrounds"
    >
        <header class="background-studio-header">
            <div>
                <h2
                    id="theme-section-backgrounds"
                    class="dashboard-section-title"
                >
                    App backgrounds
                </h2>
                <p class="supporting-text mt-1">
                    Add subtle patterns or images behind the workspace and
                    sidebar. Changes apply to this color mode only.
                </p>
            </div>
            <label class="background-toggle">
                <span>Custom backgrounds</span>
                <input
                    type="checkbox"
                    :checked="bgEnabled"
                    @change="toggleBackgrounds"
                />
                <span class="background-toggle-track" aria-hidden="true">
                    <span class="background-toggle-thumb" />
                </span>
            </label>
        </header>

        <div class="background-workspace">
            <nav class="background-layer-list" aria-label="Background areas">
                <p class="background-list-label">Background areas</p>
                <button
                    v-for="layer in layerEditors"
                    :key="layer.key"
                    type="button"
                    class="background-layer-item"
                    :class="{ active: activeLayerKey === layer.key }"
                    :aria-pressed="activeLayerKey === layer.key"
                    @click="activeLayerKey = layer.key"
                >
                    <span class="background-layer-thumb">
                        <span
                            :style="{
                                ...layer.previewStyle,
                                opacity: String(layer.opacity),
                            }"
                        />
                    </span>
                    <span class="background-layer-copy">
                        <strong>{{ layer.title }}</strong>
                        <small>{{ layer.sourceLabel }}</small>
                    </span>
                    <UIcon
                        :name="chevronIcon"
                        class="h-4 w-4 shrink-0"
                        aria-hidden="true"
                    />
                </button>
            </nav>

            <DashboardBackgroundLayerEditor
                :key="activeLayer.key"
                :title="activeLayer.title"
                :description="activeLayer.description"
                :section-id="activeLayer.sectionId"
                :url="activeLayer.url"
                :opacity="activeLayer.opacity"
                :size-px="activeLayer.sizePx"
                :repeat="activeLayer.repeat"
                :fit="activeLayer.fit"
                :color="activeLayer.color"
                :preview-style="activeLayer.previewStyle"
                :presets="activeLayer.presets"
                :bg-enabled="bgEnabled"
                :empty-label="activeLayer.emptyLabel"
                :copy-button-props="copyButtonProps"
                @update:opacity="(v: number) => onLayerOpacity(activeLayer.key, v)"
                @update:size-px="(v: number) => onLayerSize(activeLayer.key, v)"
                @update:repeat="(v: 'repeat' | 'no-repeat') => activeLayer.onRepeat(v)"
                @update:fit="(v: boolean) => activeLayer.onFit(v)"
                @update:color="(c: string) => activeLayer.onColor(c)"
                @upload="(file: File) => handleLayerUpload(file, activeLayer.key)"
                @remove="removeLayer(activeLayer.key)"
                @apply-preset="(src: string, opacity: number) => applyPreset(activeLayer.key, src, opacity)"
            />
        </div>
    </section>
</template>

<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue';
import { useToast } from '#imports';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useDebounceFn } from '@vueuse/core';
import { isBrowser } from '~/utils/env';
import { createOrRefFile } from '~/db/files';
import { useResolvedThemeAsset } from '~/core/theme/useResolvedThemeAsset';
import {
    backgroundImageValidationMessage,
    MAX_BACKGROUND_IMAGE_BYTES,
    validateBackgroundImageFile,
} from './types';
import type { BackgroundPreset } from './types';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;
const toast = useToast();

// Computed helpers for cleaner bindings
const bgEnabled = computed(() => overrides.value.backgrounds?.enabled ?? false);
const activeLayerKey = ref<LayerKey>('contentBg1');
const chevronIcon = useIcon('ui.chevron.right').value;
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

const copyButtonOverride = useThemeOverrides({
    component: 'button', context: 'dashboard', identifier: 'dashboard.theme.copy-color', isNuxtUI: true,
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
        description: 'The main workspace background.',
        sectionId: 'content-layer1',
        url: contentBg1Url.value,
        opacity: local.contentBg1Opacity,
        sizePx: local.contentBg1SizePx,
        repeat: contentBg1Repeat.value,
        fit: contentBg1Fit.value,
        color: contentBg1Color.value,
        previewStyle: contentBg1PreviewStyle.value,
        presets: presetsContent1,
        emptyLabel: 'Theme pattern',
        sourceLabel: layerSourceLabel(
            contentBg1Url.value,
            presetsContent1,
            'Theme pattern'
        ),
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
        description: 'A second layer for subtle texture or depth.',
        sectionId: 'content-layer2',
        url: contentBg2Url.value,
        opacity: local.contentBg2Opacity,
        sizePx: local.contentBg2SizePx,
        repeat: contentBg2Repeat.value,
        fit: contentBg2Fit.value,
        color: contentBg2Color.value,
        previewStyle: contentBg2PreviewStyle.value,
        presets: presetsContent2,
        emptyLabel: 'Optional overlay',
        sourceLabel: layerSourceLabel(
            contentBg2Url.value,
            presetsContent2,
            'Optional overlay'
        ),
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
        description: 'The navigation and project sidebar background.',
        sectionId: 'sidebar',
        url: sidebarBgUrl.value,
        opacity: local.sidebarBgOpacity,
        sizePx: local.sidebarBgSizePx,
        repeat: sidebarRepeat.value,
        fit: sidebarBgFit.value,
        color: sidebarBgColor.value,
        previewStyle: sidebarBgPreviewStyle.value,
        presets: presetsSidebar,
        emptyLabel: 'Theme pattern',
        sourceLabel: layerSourceLabel(
            sidebarBgUrl.value,
            presetsSidebar,
            'Theme pattern'
        ),
        onRepeat: (value: 'repeat' | 'no-repeat') =>
            set({ backgrounds: { sidebar: { repeat: value } } }),
        onFit: (value: boolean) =>
            set({ backgrounds: { sidebar: { fit: value } } }),
        onColor: (value: string) =>
            set({ backgrounds: { sidebar: { color: value } } }),
    },
]);

const activeLayer = computed(
    () =>
        layerEditors.value.find((layer) => layer.key === activeLayerKey.value) ??
        layerEditors.value[0]!
);

function toggleBackgrounds() {
    set({ backgrounds: { enabled: !bgEnabled.value } });
    themeApi.reapply();
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

const resolvedContentBg1 = useResolvedThemeAsset(contentBg1Url);
const resolvedContentBg2 = useResolvedThemeAsset(contentBg2Url);
const resolvedSidebarBg = useResolvedThemeAsset(sidebarBgUrl);

// Preview styles
const contentBg1PreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.content?.base?.fit;
    const repeatEnabled = overrides.value.backgrounds?.content?.base?.repeat === 'repeat' && !fit;
    
    return {
        backgroundImage: resolvedContentBg1.value ? `url(${resolvedContentBg1.value})` : `url(${getCssVarUrl('--app-content-bg-1') || ''})`,
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: fit ? 'cover' : repeatEnabled ? `${local.contentBg1SizePx}px` : 'contain',
        backgroundPosition: 'center',
    } as const;
});

const contentBg2PreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.content?.overlay?.fit;
    const repeatEnabled = overrides.value.backgrounds?.content?.overlay?.repeat === 'repeat' && !fit;
    
    return {
        backgroundImage: resolvedContentBg2.value ? `url(${resolvedContentBg2.value})` : `url(${getCssVarUrl('--app-content-bg-2') || ''})`,
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: fit ? 'cover' : repeatEnabled ? `${local.contentBg2SizePx}px` : 'contain',
        backgroundPosition: 'center',
    } as const;
});

const sidebarBgPreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.sidebar?.fit;
    const repeatEnabled = overrides.value.backgrounds?.sidebar?.repeat === 'repeat' && !fit;
    
    return {
        backgroundImage: resolvedSidebarBg.value ? `url(${resolvedSidebarBg.value})` : `url(${getCssVarUrl('--app-sidebar-bg-1') || ''})`,
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: fit ? 'cover' : repeatEnabled ? `${local.sidebarBgSizePx}px` : 'contain',
        backgroundPosition: 'center',
    } as const;
});

function layerSourceLabel(
    url: string | null,
    presets: BackgroundPreset[],
    emptyLabel: string
): string {
    if (!url) return emptyLabel;
    if (presets.some((preset) => preset.src === url)) return 'Theme pattern';
    return 'Custom image';
}

function showUploadError(description: string) {
    toast.add({
        title: 'Background image not applied',
        description,
        color: 'error',
    });
}

function applyUploadedLayer(
    which: LayerKey,
    token: string,
    currentOpacity: number
) {
    // Photos are usually meant as a single cover image, not a tiny tiled pattern.
    const layer = {
        url: token,
        fit: true,
        repeat: 'no-repeat' as const,
        // Keep a visible floor so a 0% leftover from "remove" does not hide the upload.
        opacity: currentOpacity > 0 ? currentOpacity : 0.35,
    };
    if (which === 'contentBg1') {
        set({ backgrounds: { content: { base: layer } } });
        local.contentBg1Opacity = layer.opacity;
        return;
    }
    if (which === 'contentBg2') {
        set({ backgrounds: { content: { overlay: layer } } });
        local.contentBg2Opacity = layer.opacity;
        return;
    }
    set({ backgrounds: { sidebar: layer } });
    local.sidebarBgOpacity = layer.opacity;
}

// File upload handler with security validation
async function handleLayerUpload(file: File, which: LayerKey) {
    try {
        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const validation = validateBackgroundImageFile({
            type: file.type,
            size: file.size,
            header,
        });
        if (!validation.ok) {
            showUploadError(backgroundImageValidationMessage(validation.reason));
            if (import.meta.dev) {
                console.error('[BackgroundLayersSection] Upload rejected:', {
                    reason: validation.reason,
                    type: file.type || '(empty)',
                    size: file.size,
                    maxBytes: MAX_BACKGROUND_IMAGE_BYTES,
                });
            }
            return;
        }

        // Normalize MIME when Finder/macOS leaves File.type empty or wrong.
        const uploadFile =
            file.type === validation.mime
                ? file
                : new File([file], file.name || 'upload', {
                      type: validation.mime,
                      lastModified: file.lastModified,
                  });

        const meta = await createOrRefFile(
            uploadFile,
            uploadFile.name || 'upload'
        );
        const token = `internal-file://${meta.hash}`;
        const currentOpacity = local[layerLocalKeys[which].opacity];
        applyUploadedLayer(which, token, currentOpacity);

        toast.add({
            title: 'Background image applied',
            description: 'Saved for this color mode.',
            color: 'success',
        });

        if (import.meta.dev) {
            console.log(
                '[BackgroundLayersSection] Image saved:',
                meta.hash.slice(0, 8)
            );
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Please try again.';
        showUploadError(message);
        console.error('[BackgroundLayersSection] Upload failed:', message);
    }
}

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

<style scoped>
.background-studio {
    width: 100%;
    max-width: 74rem;
    margin-inline: auto;
    --background-editor-accent: var(--md-primary);
    --background-editor-on-accent: var(--md-on-primary);
    --background-editor-accent-container: var(--md-primary-container);
    --background-editor-on-accent-container: var(--md-on-primary-container);
    --background-editor-subtle: var(
        --md-surface-container-low,
        var(--md-surface)
    );
    --background-editor-border: var(
        --md-outline-variant,
        var(--md-border-color)
    );
}
.background-studio-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
}
.background-studio-header .dashboard-section-title {
    font-size: 1.25rem;
    font-weight: 650;
}
.background-studio-header .supporting-text {
    max-width: 68ch;
    font-size: 0.8125rem;
}
.background-toggle {
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
.background-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
}
.background-toggle-track {
    position: relative;
    display: block;
    width: 2.4rem;
    height: 1.35rem;
    background: var(--background-editor-border);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: 999px;
    transition: background-color var(--app-motion-duration-fast, 120ms)
        var(--app-motion-easing-standard, ease);
}
.background-toggle-thumb {
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
.background-toggle input:checked + .background-toggle-track {
    background: var(--background-editor-accent);
}
.background-toggle input:checked + .background-toggle-track .background-toggle-thumb {
    left: 1.18rem;
}
.background-toggle input:focus-visible + .background-toggle-track {
    outline: var(--app-focus-ring-width, 3px) solid
        var(--md-focus-ring, var(--background-editor-accent));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
.background-workspace {
    display: grid;
    min-width: 0;
    gap: 1.25rem;
    margin-top: 1rem;
    padding-top: 0.8rem;
    border-top: var(--md-border-width) solid var(--background-editor-border);
}
.background-layer-list {
    min-width: 0;
}
.background-list-label {
    margin-bottom: 0.35rem;
    padding: 0.35rem 0.65rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}
.background-layer-item {
    display: grid;
    width: 100%;
    min-height: 4.25rem;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem;
    color: var(--md-on-surface);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--md-border-radius-small);
    cursor: pointer;
}
.background-layer-item:hover {
    background: var(--background-editor-subtle);
}
.background-layer-item.active {
    color: var(--background-editor-on-accent-container);
    background: var(--background-editor-accent-container);
    box-shadow: inset var(--md-border-width-strong) 0 0
        var(--background-editor-accent);
}
.background-layer-item:focus-visible {
    outline: var(--app-focus-ring-width, 3px) solid
        var(--md-focus-ring, var(--background-editor-accent));
    outline-offset: calc(-1 * var(--app-focus-ring-width, 3px));
}
.background-layer-thumb {
    position: relative;
    display: block;
    width: 4.5rem;
    height: 3rem;
    overflow: hidden;
    background: var(--background-editor-subtle);
    border: var(--md-border-width) solid var(--background-editor-border);
    border-radius: var(--md-border-radius-small);
}
.background-layer-thumb > span {
    position: absolute;
    inset: 0;
}
.background-layer-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.15rem;
}
.background-layer-copy strong {
    overflow: hidden;
    font-size: 0.85rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.background-layer-copy small {
    overflow: hidden;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.background-layer-item.active .background-layer-copy small {
    color: inherit;
    opacity: 0.78;
}
@media (max-width: 520px) {
    .background-layer-item {
        grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    }
    .background-layer-thumb {
        width: 3.5rem;
        height: 2.5rem;
    }
}
@media (min-width: 920px) {
    .background-workspace {
        grid-template-columns: minmax(16rem, 0.72fr) minmax(24rem, 1.28fr);
        align-items: start;
    }
    .background-inspector {
        padding-left: 1.25rem;
        border-left: var(--md-border-width) solid var(--background-editor-border);
    }
}
</style>
