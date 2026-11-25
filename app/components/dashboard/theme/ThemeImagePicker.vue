<template>
    <AppModal
        :open="open"
        :title="`Choose image for ${areaLabel}`"
        size="md"
        @update:open="emit('update:open', $event)"
    >
        <div class="theme-image-picker">
            <UInput
                v-model="query"
                :icon="searchIcon"
                size="workspace"
                class="w-full"
                placeholder="Search images"
                aria-label="Search images by name"
            />

            <div
                ref="gridRef"
                class="theme-image-grid"
                role="listbox"
                aria-label="Workspace images"
                @keydown="onGridKeydown"
            >
                <button
                    type="button"
                    class="theme-image-tile theme-image-upload"
                    data-picker-tile
                    @click="fileInputRef?.click()"
                >
                    <UIcon :name="uploadIcon" class="h-5 w-5" aria-hidden="true" />
                    <span>Upload new</span>
                </button>
                <button
                    v-for="image in images"
                    :key="image.hash"
                    type="button"
                    role="option"
                    class="theme-image-tile"
                    :class="{ selected: selectedHash === image.hash }"
                    :aria-selected="selectedHash === image.hash"
                    :aria-label="image.name"
                    :title="image.name"
                    data-picker-tile
                    @click="selectedHash = image.hash"
                    @dblclick="apply(image.hash)"
                    @keydown.enter.prevent="apply(image.hash)"
                >
                    <PaletteImageThumb
                        :hash="image.hash"
                        :alt="image.name"
                        :fallback-icon="imageIcon"
                        :size-bytes="image.size_bytes"
                        class="theme-image-thumb"
                    />
                    <span v-if="image.hash === currentHash" class="theme-image-badge">In use</span>
                    <span v-if="selectedHash === image.hash" class="theme-image-check" aria-hidden="true">
                        <UIcon :name="checkIcon" class="h-3 w-3" />
                    </span>
                </button>
            </div>

            <p v-if="!loading && !images.length" class="theme-image-empty">
                {{ query.trim() ? `No images match “${query.trim()}”.` : 'No images yet. Upload one to get started.' }}
            </p>
            <div v-if="hasMore" class="flex justify-center">
                <UButton
                    label="Show more"
                    size="workspace"
                    color="neutral"
                    variant="ghost"
                    :loading="loading"
                    @click="limit += PAGE_SIZE"
                />
            </div>

            <input
                ref="fileInputRef"
                type="file"
                hidden
                tabindex="-1"
                aria-hidden="true"
                accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                @change="onUpload"
            />
        </div>

        <template #footer>
            <span class="theme-image-selection" aria-live="polite">{{ selectionLabel }}</span>
            <UButton
                label="Cancel"
                size="workspace"
                color="neutral"
                variant="ghost"
                @click="emit('update:open', false)"
            />
            <UButton
                label="Use image"
                size="workspace"
                :disabled="!selectedHash"
                @click="selectedHash && apply(selectedHash)"
            />
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { watchDebounced } from '@vueuse/core';
import AppModal from '~/components/ui/AppModal.vue';
import PaletteImageThumb from '~/components/search/PaletteImageThumb.vue';
import { listBackgroundImages } from '~/core/theme/background-image-library';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import type { FileMeta } from '~/db/schema';
import { useIcon } from '~/composables/useIcon';

const PAGE_SIZE = 24;
const MAX_LIMIT = 240;

const props = defineProps<{
    open: boolean;
    areaLabel: string;
    /** Hash of the image the area currently uses, if any. */
    currentHash: string | null;
}>();

const emit = defineEmits<{
    'update:open': [value: boolean];
    select: [hash: string];
    upload: [file: File];
}>();

const searchIcon = useIcon('ui.search');
const uploadIcon = useIcon('ui.upload');
const imageIcon = useIcon('palette.image');
const checkIcon = useIcon('ui.check');

const query = ref('');
const limit = ref(PAGE_SIZE);
const images = ref<FileMeta[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const selectedHash = ref<string | null>(null);
const gridRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
let loadToken = 0;

const selectionLabel = computed(() => {
    const image = images.value.find((item) => item.hash === selectedHash.value);
    if (!image) return '';
    const mb = image.size_bytes / (1024 * 1024);
    return `${image.name} · ${mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(image.size_bytes / 1024))} KB`}`;
});

async function load() {
    const token = ++loadToken;
    const generation = getWorkspaceGeneration();
    loading.value = true;
    try {
        const page = await listBackgroundImages({
            limit: Math.min(limit.value, MAX_LIMIT),
            query: query.value,
        });
        if (token !== loadToken || generation !== getWorkspaceGeneration()) return;
        images.value = page.items;
        hasMore.value = page.hasMore && limit.value < MAX_LIMIT;
    } catch (error) {
        if (token !== loadToken) return;
        images.value = [];
        hasMore.value = false;
        console.error('[ThemeImagePicker] Failed to list images:', error);
    } finally {
        if (token === loadToken) loading.value = false;
    }
}

watch(
    () => props.open,
    (open) => {
        if (!open) {
            loadToken++;
            return;
        }
        query.value = '';
        limit.value = PAGE_SIZE;
        selectedHash.value = props.currentHash;
        void load();
    },
    { immediate: true }
);
watch(limit, () => props.open && void load());
watchDebounced(
    query,
    () => {
        if (!props.open) return;
        limit.value = PAGE_SIZE;
        void load();
    },
    { debounce: 150 }
);

// Another workspace's images must never be offered for this one.
const stopWorkspace = subscribeActiveWorkspaceDb(() => {
    if (props.open) emit('update:open', false);
});
onBeforeUnmount(stopWorkspace);

function apply(hash: string) {
    emit('select', hash);
    emit('update:open', false);
}

function onUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    emit('upload', file);
    emit('update:open', false);
}

/** Arrow keys move focus through the grid, row by row. */
function onGridKeydown(event: KeyboardEvent) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key) || !gridRef.value) return;
    const tiles = Array.from(gridRef.value.querySelectorAll<HTMLElement>('[data-picker-tile]'));
    const index = tiles.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const columns = getComputedStyle(gridRef.value).gridTemplateColumns.split(' ').length || 1;
    const step: Record<string, number> = {
        ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns,
        Home: -index, End: tiles.length - 1 - index,
    };
    const next = tiles[Math.min(tiles.length - 1, Math.max(0, index + step[event.key]!))];
    if (!next) return;
    event.preventDefault();
    next.focus();
}
</script>

<style scoped>
.theme-image-picker {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
}
.theme-image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    gap: 0.625rem;
    max-height: min(26rem, 55dvh);
    padding: 0.25rem;
    overflow-y: auto;
}
.theme-image-tile {
    position: relative;
    display: grid;
    aspect-ratio: 1;
    max-width: 100%;
    overflow: hidden;
    place-items: center;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: var(--md-surface-variant);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    cursor: pointer;
}
.theme-image-tile:hover {
    border-color: var(--md-primary);
}
.theme-image-tile:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
.theme-image-tile.selected {
    border-color: var(--md-primary);
    box-shadow: 0 0 0 2px var(--md-primary);
}
.theme-image-upload {
    align-content: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-style: dashed;
}
.theme-image-thumb {
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    border: 0 !important;
    border-radius: 0 !important;
}
.theme-image-badge {
    position: absolute;
    bottom: 0.3rem;
    left: 0.3rem;
    padding: 0.05rem 0.35rem;
    color: var(--md-on-surface);
    font-size: 0.625rem;
    font-weight: 700;
    background: color-mix(in srgb, var(--md-surface) 88%, transparent);
    border-radius: var(--md-border-radius-small, 4px);
}
.theme-image-check {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    display: grid;
    width: 1.25rem;
    height: 1.25rem;
    place-items: center;
    color: var(--md-on-primary);
    background: var(--md-primary);
    border-radius: 999px;
}
.theme-image-empty {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.8125rem;
    text-align: center;
}
.theme-image-selection {
    min-width: 0;
    margin-right: auto;
    overflow: hidden;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
