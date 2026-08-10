<template>
    <section
        :id="`dashboard-theme-${sectionId}-section`"
        class="background-inspector"
        role="group"
        :aria-labelledby="`theme-section-${sectionId}`"
    >
        <header class="background-inspector-header">
            <div>
                <h3
                    :id="`theme-section-${sectionId}`"
                    class="background-inspector-title"
                >
                    {{ title }}
                </h3>
                <p v-if="description" class="background-inspector-description">
                    {{ description }}
                </p>
            </div>
            <span class="background-source-status">
                {{ url ? displayName : emptyLabel }}
            </span>
        </header>

        <div class="background-inspector-body">
            <div
                class="background-preview"
                :class="{
                    'is-muted': !url || opacity === 0,
                    'is-dragging': isDragOver,
                }"
                :style="{ backgroundColor: color || undefined }"
                :aria-label="`${title} (click or drop to upload)`"
                role="button"
                tabindex="0"
                @click="openFileInput"
                @keydown.enter.prevent="openFileInput"
                @dragenter.prevent="isDragOver = true"
                @dragover.prevent
                @dragleave.prevent="isDragOver = false"
                @drop.prevent="onDrop"
            >
                <span
                    class="background-preview-image"
                    :style="{ ...previewStyle, opacity: String(opacity) }"
                    aria-hidden="true"
                />
                <span class="background-preview-action" aria-hidden="true">
                    {{ url ? 'Replace image' : 'Upload image' }}
                </span>
            </div>

            <input
                ref="fileInputRef"
                type="file"
                class="sr-only"
                accept="image/*"
                @change="onUpload"
            />

            <section class="background-control-section">
                <h4>Image</h4>
                <div class="background-action-row">
                    <button
                        v-for="preset in presets"
                        :key="preset.src"
                        type="button"
                        class="background-action-button"
                        :class="{ active: url === preset.src }"
                        :disabled="!bgEnabled"
                        @click="$emit('apply-preset', preset.src, preset.opacity)"
                    >
                        {{
                            preset.label === 'Default'
                                ? 'Use theme pattern'
                                : preset.label
                        }}
                    </button>
                    <button
                        type="button"
                        class="background-action-button"
                        :disabled="!bgEnabled"
                        @click="openFileInput"
                    >
                        Upload image
                    </button>
                    <button
                        type="button"
                        class="background-action-button"
                        :disabled="!bgEnabled || !url"
                        @click="$emit('remove')"
                    >
                        Remove
                    </button>
                </div>
            </section>

            <section class="background-control-section">
                <h4>Layout</h4>
                <div
                    class="background-layout-options"
                    role="group"
                    aria-label="Image layout"
                >
                    <button
                        type="button"
                        :disabled="!bgEnabled"
                        :class="{ active: repeat === 'no-repeat' && !fit }"
                        :aria-pressed="repeat === 'no-repeat' && !fit"
                        @click="selectLayout('single')"
                    >
                        Single
                    </button>
                    <button
                        type="button"
                        :disabled="!bgEnabled"
                        :class="{ active: repeat === 'repeat' && !fit }"
                        :aria-pressed="repeat === 'repeat' && !fit"
                        @click="selectLayout('repeat')"
                    >
                        Repeat
                    </button>
                    <button
                        type="button"
                        :disabled="!bgEnabled"
                        :class="{ active: fit }"
                        :aria-pressed="fit"
                        @click="selectLayout('fit')"
                    >
                        Fill area
                    </button>
                </div>
            </section>

            <section class="background-control-section background-sliders">
                <h4>Appearance</h4>
                <label class="background-slider-row">
                    <span>Opacity</span>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        :value="opacity"
                        :disabled="!bgEnabled"
                        @input="onOpacityInput"
                    />
                    <output>{{ Math.round(opacity * 100) }}%</output>
                </label>
                <label class="background-slider-row">
                    <span>Pattern size</span>
                    <input
                        type="range"
                        min="8"
                        max="1200"
                        :disabled="fit || !bgEnabled"
                        :value="sizePx"
                        @input="onSizeInput"
                    />
                    <output>{{ fit ? 'Cover' : sizePx + 'px' }}</output>
                </label>
            </section>

            <section class="background-control-section">
                <h4>Base color</h4>
                <div class="background-color-row">
                    <input
                        class="background-color-swatch"
                        type="color"
                        :value="validColor"
                        :disabled="!bgEnabled"
                        :aria-label="`${title} base color picker`"
                        @input="onNativeColor"
                    />
                    <input
                        class="background-hex-input"
                        type="text"
                        placeholder="#RRGGBB"
                        :value="localHexColor"
                        :disabled="!bgEnabled"
                        :aria-label="`${title} base color`"
                        @input="onHexInput"
                    />
                    <UButton
                        v-bind="copyButtonProps"
                        class="shrink-0"
                        :disabled="!bgEnabled || !color.startsWith('#')"
                        :aria-label="`Copy ${title} color`"
                        :title="`Copy ${title} color`"
                        @click="copyColor"
                    />
                </div>
                <p>The base color shows beneath transparent images.</p>
            </section>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useClipboard } from '@vueuse/core';

export interface BackgroundPreset {
    label: string;
    src: string;
    opacity: number;
}

const props = defineProps<{
    title: string;
    description?: string;
    sectionId: string;
    url: string | null;
    opacity: number;
    sizePx: number;
    repeat: 'repeat' | 'no-repeat';
    fit: boolean;
    color: string;
    previewStyle: Record<string, string>;
    presets: BackgroundPreset[];
    bgEnabled: boolean;
    emptyLabel?: string;
    copyButtonProps?: Record<string, any>;
}>();

const emit = defineEmits<{
    'update:opacity': [value: number];
    'update:sizePx': [value: number];
    'update:repeat': [value: 'repeat' | 'no-repeat'];
    'update:fit': [value: boolean];
    'update:color': [value: string];
    upload: [file: File];
    remove: [];
    'apply-preset': [src: string, opacity: number];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const localHexColor = ref(props.color.startsWith('#') ? props.color : '');
const validColor = computed(() =>
    /^#[0-9a-fA-F]{6}$/.test(props.color) ? props.color : '#ffffff'
);
const displayName = computed(() => {
    if (!props.url) return '';
    if (props.url.startsWith('internal-file://')) return 'Saved image';
    if (props.url.startsWith('blob:')) return 'Uploaded image';
    try {
        const url = new URL(props.url, 'http://localhost');
        return url.pathname.split('/').pop() || 'Background image';
    } catch {
        return props.url.split('/').pop() || 'Background image';
    }
});

watch(
    () => props.color,
    (newColor) => {
        if (newColor.startsWith('#')) localHexColor.value = newColor;
    }
);

function openFileInput() {
    if (props.bgEnabled) fileInputRef.value?.click();
}

function onDrop(event: DragEvent) {
    isDragOver.value = false;
    if (!props.bgEnabled) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) emit('upload', file);
}

function onUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) emit('upload', file);
    input.value = '';
}

function onOpacityInput(event: Event) {
    emit('update:opacity', Number((event.currentTarget as HTMLInputElement).value));
}

function onSizeInput(event: Event) {
    emit('update:sizePx', Number((event.currentTarget as HTMLInputElement).value));
}

function selectLayout(layout: 'single' | 'repeat' | 'fit') {
    if (!props.bgEnabled) return;
    emit('update:fit', layout === 'fit');
    emit('update:repeat', layout === 'repeat' ? 'repeat' : 'no-repeat');
}

function onNativeColor(event: Event) {
    const color = (event.currentTarget as HTMLInputElement).value.toLowerCase();
    localHexColor.value = color;
    emit('update:color', color);
}

function onHexInput(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value;
    localHexColor.value = raw;
    const candidate = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(candidate)) {
        emit('update:color', candidate.toLowerCase());
    }
}

const { copy } = useClipboard();
function copyColor() {
    if (props.color.startsWith('#')) copy(props.color);
}
</script>

<style scoped>
.background-inspector {
    min-width: 0;
    padding: 0.55rem 0;
    color: var(--md-on-surface);
}
.background-inspector-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 0.75rem 0.8rem;
}
.background-inspector-title {
    font-size: 1.0625rem;
    font-weight: 650;
}
.background-inspector-description {
    max-width: 58ch;
    margin-top: 0.2rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.76rem;
    line-height: 1.4;
}
.background-source-status {
    flex: 0 0 auto;
    max-width: 12rem;
    overflow: hidden;
    padding: 0.25rem 0.45rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.66rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--background-editor-subtle);
    border-radius: var(--md-border-radius-small);
}
.background-inspector-body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
    padding: 0 0.75rem 0.75rem;
}
.background-preview {
    position: relative;
    display: grid;
    width: 100%;
    min-height: 11rem;
    overflow: hidden;
    place-items: center;
    background: var(--background-editor-subtle);
    border: var(--md-border-width) solid var(--background-editor-border);
    border-radius: var(--md-border-radius);
    cursor: pointer;
    isolation: isolate;
}
.background-preview-image {
    position: absolute;
    z-index: -1;
    inset: 0;
}
.background-preview.is-muted .background-preview-image {
    opacity: 0.35 !important;
}
.background-preview.is-dragging,
.background-preview:focus-visible {
    outline: 3px solid var(--background-editor-accent);
    outline-offset: 2px;
}
.background-preview-action {
    padding: 0.45rem 0.7rem;
    color: var(--md-on-surface);
    font-size: 0.72rem;
    font-weight: 700;
    background: color-mix(in srgb, var(--md-surface) 90%, transparent);
    border: var(--md-border-width) solid var(--background-editor-border);
    border-radius: var(--md-border-radius-small);
}
.background-control-section {
    padding-top: 0.8rem;
    border-top: var(--md-border-width-subtle) solid var(--background-editor-border);
}
.background-control-section h4 {
    margin-bottom: 0.55rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}
.background-control-section > p {
    margin-top: 0.35rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.68rem;
}
.background-action-row,
.background-layout-options,
.background-color-row {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}
.background-action-button {
    min-height: 2.35rem;
    padding: 0.4rem 0.65rem;
    color: var(--md-on-surface) !important;
    background: var(--md-surface) !important;
    border: var(--md-border-width) solid var(--background-editor-border) !important;
    border-radius: var(--md-border-radius-small) !important;
}
.background-action-button:hover:not(:disabled):not(.active) {
    color: var(--md-on-surface) !important;
    background: var(
        --md-surface-hover,
        var(--md-surface-container-high, var(--md-surface))
    ) !important;
    border-color: var(--md-primary) !important;
}
.background-action-button.active {
    color: var(--md-on-primary) !important;
    background: var(--background-editor-accent) !important;
    border-color: var(--background-editor-accent) !important;
}
.background-action-button.active:hover:not(:disabled) {
    color: var(--md-on-primary) !important;
    background: var(
        --md-primary-hover,
        var(--background-editor-accent)
    ) !important;
}
.background-action-button:disabled {
    color: var(--md-on-surface-variant) !important;
    background: var(--md-surface-variant) !important;
    border-color: var(--md-outline-variant) !important;
    opacity: 0.62 !important;
}
.background-layout-options button {
    min-width: 6.5rem;
    min-height: 2.35rem;
    padding: 0.4rem 0.65rem;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--background-editor-border);
    border-radius: var(--md-border-radius-small);
}
.background-layout-options button:hover:not(:disabled):not(.active) {
    color: var(--md-on-surface);
    background: var(
        --md-surface-hover,
        var(--background-editor-subtle)
    );
    border-color: var(--background-editor-accent);
}
.background-layout-options button.active {
    color: var(--background-editor-on-accent);
    background: var(--background-editor-accent);
    border-color: var(--background-editor-accent);
}
.background-layout-options button.active:hover:not(:disabled) {
    color: var(--md-on-primary);
    background: var(--md-primary-hover, var(--md-primary));
}
.background-layout-options button:focus-visible {
    outline: 3px solid var(--background-editor-accent);
    outline-offset: 2px;
}
.background-layout-options button:disabled {
    color: var(--md-on-surface-variant);
    background: var(--md-surface-variant);
    border-color: var(--md-outline-variant);
    cursor: not-allowed;
    opacity: 0.62;
}
.background-sliders {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.background-slider-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 6.5rem minmax(7rem, 1fr) 4rem;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.76rem;
}
.background-slider-row input {
    min-width: 0;
    accent-color: var(--background-editor-accent);
}
.background-slider-row output {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    text-align: right;
}
.background-color-swatch {
    width: 2.5rem;
    height: 2.35rem;
    padding: 0.18rem;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--background-editor-border);
    border-radius: var(--md-border-radius-small);
    cursor: pointer;
}
.background-hex-input {
    width: min(11rem, 100%);
    min-height: 2.35rem;
    padding: 0.4rem 0.55rem;
    color: var(--md-on-surface) !important;
    background: var(--background-editor-subtle) !important;
    border: var(--md-border-width) solid var(--background-editor-border) !important;
    border-radius: var(--md-border-radius-small);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
}
.background-hex-input:focus-visible,
.background-color-swatch:focus-visible {
    outline: 2px solid var(--background-editor-accent);
    outline-offset: 2px;
}
@media (max-width: 520px) {
    .background-inspector-header {
        flex-direction: column;
    }
    .background-preview {
        min-height: 9rem;
    }
    .background-slider-row {
        grid-template-columns: 1fr auto;
    }
    .background-slider-row input {
        grid-column: 1 / -1;
        grid-row: 2;
        width: 100%;
    }
}
</style>
