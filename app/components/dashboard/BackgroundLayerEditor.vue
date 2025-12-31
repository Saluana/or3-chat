<template>
    <section
        :id="`dashboard-theme-${sectionId}-section`"
        class="section-card space-y-4"
        role="group"
        :aria-labelledby="`theme-section-${sectionId}`"
    >
        <h2
            :id="`theme-section-${sectionId}`"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            {{ title }}
        </h2>
        <p v-if="description" class="supporting-text">
            {{ description }}
        </p>

        <!-- Preview row -->
        <div class="flex items-center gap-3">
            <div
                class="pattern-thumb drop-zone relative flex h-24 w-[140px] flex-col items-center justify-center overflow-hidden rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)]/90 text-[var(--md-on-surface)] shadow-[2px_2px_0_var(--md-border-color)] transition-all duration-150"
                :class="[
                    !url || opacity === 0 ? 'opacity-60' : '',
                    isDragOver
                        ? 'ring-2 ring-[color:var(--md-primary)] ring-offset-2 ring-offset-[var(--md-surface)] scale-[1.01]'
                        : '',
                ]"
                :style="previewStyle"
                :aria-label="`${title} (click or drop to upload)`"
                role="button"
                tabindex="0"
                @click="openFileInput"
                @keydown.enter.prevent="openFileInput"
                @dragenter.prevent="onDragEnter"
                @dragover.prevent="onDragOver"
                @dragleave.prevent="onDragLeave"
                @drop.prevent="onDrop"
            >
                <div
                    v-if="url"
                    class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"
                ></div>
                <span
                    class="relative z-10 rounded bg-[var(--md-surface)]/85 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em]"
                    aria-hidden="true"
                >
                    {{ url ? 'Replace' : 'Drop / Tap' }}
                </span>
            </div>
            <span class="text-xs truncate max-w-40" :title="displayName">
                {{ displayName || emptyLabel }}
            </span>
        </div>

        <!-- Preset buttons and controls row -->
        <div class="flex flex-wrap gap-2 items-center">
            <span class="text-xs opacity-70">Presets:</span>
            <UButton
                v-bind="presetButtonProps"
                v-for="p in presets"
                :key="p.src"
                @click="$emit('apply-preset', p.src, p.opacity)"
                :class="url === p.src ? 'active' : ''"
            >
                {{ p.label }}
            </UButton>
            <UButton v-bind="removeLayerButtonProps" @click="$emit('remove')">
                Remove
            </UButton>
            <!-- hidden input for programmatic trigger -->
            <input
                ref="fileInputRef"
                type="file"
                class="sr-only"
                accept="image/*"
                @change="onUpload"
            />
            <UButton
                v-bind="repeatButtonProps"
                @click="$emit('update:repeat', repeat === 'repeat' ? 'no-repeat' : 'repeat')"
                :aria-pressed="repeat === 'repeat'"
            >
                Repeat: {{ repeat === 'repeat' ? 'On' : 'Off' }}
            </UButton>
            <label
                class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
            >
                <input
                    type="checkbox"
                    :checked="fit"
                    @change="$emit('update:fit', !fit)"
                />
                Fit
            </label>
        </div>

        <!-- Opacity slider -->
        <div class="flex items-center gap-4">
            <label class="w-32">Opacity</label>
            <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="opacity"
                @input="onOpacityInput"
                class="flex-1"
            />
            <span class="w-12 text-right tabular-nums">{{
                opacity.toFixed(2)
            }}</span>
        </div>

        <!-- Size slider -->
        <div class="flex items-center gap-4">
            <label class="w-32">Size</label>
            <input
                type="range"
                min="8"
                max="1200"
                :disabled="fit"
                :value="sizePx"
                @input="onSizeInput"
                class="flex-1"
            />
            <span class="w-16 text-right tabular-nums text-xs">{{
                fit ? 'cover' : sizePx + 'px'
            }}</span>
        </div>

        <!-- Fallback Color -->
        <div class="flex items-start gap-4 fallback-row">
            <label class="w-32 text-xs pt-2">Fallback Color</label>
            <div class="flex flex-col gap-2 w-full sm:w-auto">
                <UColorPicker
                    v-bind="colorPickerProps"
                    :disabled="!bgEnabled"
                    :model-value="
                        bgEnabled && color.startsWith('#') ? color : undefined
                    "
                    @update:model-value="(c: string | undefined) => c && $emit('update:color', c)"
                    class="scale-60 origin-left"
                />
                <div class="flex items-center gap-2">
                    <UInput
                        v-bind="hexInputProps"
                        class="flex-1 sm:w-24 h-8"
                        type="text"
                        placeholder="#RRGGBB"
                        :model-value="localHexColor"
                        @update:model-value="onHexInput"
                        :disabled="!bgEnabled"
                        :aria-label="`${title} fallback hex color`"
                    />
                    <UButton
                        v-bind="copyButtonProps"
                        class="shrink-0"
                        @click="copyColor"
                        :disabled="!bgEnabled || !color.startsWith('#')"
                        :aria-label="`Copy ${title} color`"
                        :title="`Copy ${title} color`"
                    />
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useClipboard } from '@vueuse/core';

export interface BackgroundPreset {
    label: string;
    src: string;
    opacity: number;
}

const props = defineProps<{
    /** Section heading */
    title: string;
    /** Supporting description text */
    description?: string;
    /** ID suffix for accessibility (e.g., 'content1', 'sidebar') */
    sectionId: string;
    /** Current background URL */
    url: string | null;
    /** Current opacity (0-1) */
    opacity: number;
    /** Current size in pixels */
    sizePx: number;
    /** Repeat mode */
    repeat: 'repeat' | 'no-repeat';
    /** Fit to cover */
    fit: boolean;
    /** Fallback hex color */
    color: string;
    /** Computed preview style object */
    previewStyle: Record<string, string>;
    /** Array of preset options */
    presets: BackgroundPreset[];
    /** Whether backgrounds are globally enabled */
    bgEnabled: boolean;
    /** Label shown when no URL is set */
    emptyLabel?: string;
    /** Props for preset buttons */
    presetButtonProps?: Record<string, any>;
    /** Props for remove button */
    removeLayerButtonProps?: Record<string, any>;
    /** Props for repeat toggle button */
    repeatButtonProps?: Record<string, any>;
    /** Props for color picker */
    colorPickerProps?: Record<string, any>;
    /** Props for hex input */
    hexInputProps?: Record<string, any>;
    /** Props for copy button */
    copyButtonProps?: Record<string, any>;
}>();

const emit = defineEmits<{
    'update:url': [value: string | null];
    'update:opacity': [value: number];
    'update:sizePx': [value: number];
    'update:repeat': [value: 'repeat' | 'no-repeat'];
    'update:fit': [value: boolean];
    'update:color': [value: string];
    'upload': [file: File];
    'remove': [];
    'apply-preset': [src: string, opacity: number];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const localHexColor = ref(props.color.startsWith('#') ? props.color : '');

// Sync local hex color when prop changes
watch(() => props.color, (newColor) => {
    if (newColor.startsWith('#')) {
        localHexColor.value = newColor;
    }
});

// Display name for URL
const displayName = computed(() => {
    if (!props.url) return '';
    if (props.url.startsWith('internal-file://')) return 'Saved Image';
    try {
        if (props.url.startsWith('blob:')) return 'Uploaded';
        const url = new URL(props.url, window.location.origin);
        return url.pathname.split('/').pop() || props.url;
    } catch {
        return props.url.split('/').pop() || props.url;
    }
});

// Clipboard utility
const { copy } = useClipboard();

function openFileInput() {
    fileInputRef.value?.click();
}

function onDragEnter() {
    isDragOver.value = true;
}

function onDragOver() {
    // Keep drag state active
}

function onDragLeave() {
    isDragOver.value = false;
}

function onDrop(e: DragEvent) {
    isDragOver.value = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
        emit('upload', file);
    }
}

function onUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
        emit('upload', file);
    }
    // Reset input so same file can be reselected
    if (input) input.value = '';
}

function onOpacityInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    emit('update:opacity', v);
}

function onSizeInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    emit('update:sizePx', v);
}

function onHexInput(value: any) {
    const raw = String(value ?? '');
    localHexColor.value = raw;
    
    // Validate and emit if valid
    const candidate = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(candidate)) {
        emit('update:color', candidate.toLowerCase());
    }
}

function copyColor() {
    if (props.color.startsWith('#')) {
        copy(props.color);
    }
}
</script>
