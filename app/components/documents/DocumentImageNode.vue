<template>
    <NodeViewWrapper
        class="or3-document-image"
        :class="{ 'is-selected': selected }"
        :style="{ '--image-width': `${node.attrs.width || 100}%` }"
        data-drag-handle
    >
        <div v-if="loading" class="image-placeholder">Loading image…</div>
        <img
            v-else-if="objectUrl"
            :src="objectUrl"
            :alt="node.attrs.alt || ''"
            draggable="false"
        />
        <div v-else class="image-placeholder image-error">Image unavailable</div>
        <div v-if="selected" class="image-controls" contenteditable="false">
            <label>
                <span class="sr-only">Image alt text</span>
                <UInput
                    :model-value="node.attrs.alt || ''"
                    size="sm"
                    aria-label="Image alt text"
                    placeholder="Describe this image"
                    @change="setAlt"
                />
            </label>
            <label class="image-size">
                <span class="sr-only">Image width</span>
                <USlider
                    :min="25"
                    :max="100"
                    :step="5"
                    :model-value="Number(node.attrs.width || 100)"
                    tooltip
                    aria-label="Image width"
                    @update:model-value="setWidth"
                />
            </label>
            <UButton color="error" variant="ghost" size="sm" label="Remove" aria-label="Remove image" @click="deleteNode" />
        </div>
    </NodeViewWrapper>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';
import { getFileBlob } from '~/db/files';

const props = defineProps<NodeViewProps>();
const objectUrl = ref('');
const loading = ref(false);

function releaseUrl() {
    if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = '';
}

async function loadImage(hash: string) {
    releaseUrl();
    if (!hash) return;
    loading.value = true;
    try {
        const blob = await getFileBlob(hash);
        if (blob && props.node.attrs.hash === hash) {
            objectUrl.value = URL.createObjectURL(blob);
        }
    } finally {
        loading.value = false;
    }
}

watch(() => String(props.node.attrs.hash || ''), loadImage, { immediate: true });
onBeforeUnmount(releaseUrl);

function setAlt(event: Event) {
    props.updateAttributes({ alt: (event.target as HTMLInputElement).value });
}

function setWidth(value: number | number[] | undefined) {
    const width = Array.isArray(value) ? value[0] : value;
    if (typeof width === 'number') props.updateAttributes({ width });
}
</script>

<style scoped>
.or3-document-image {
    position: relative;
    width: min(var(--image-width), 100%);
    margin: 1.5rem auto;
}

.or3-document-image img,
.image-placeholder {
    display: block;
    width: 100%;
    min-height: 8rem;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    object-fit: contain;
    background: color-mix(in oklab, var(--md-surface-container), transparent 20%);
}

.or3-document-image.is-selected img {
    outline: 2px solid var(--md-primary);
    outline-offset: 3px;
}

.image-placeholder {
    display: grid;
    place-items: center;
    color: var(--md-on-surface-variant);
    border: var(--md-border-width-subtle, var(--md-border-width)) dashed var(--md-border-color);
}

.image-controls {
    position: absolute;
    z-index: 2;
    inset-inline: 0;
    bottom: 0.75rem;
    width: max-content;
    max-width: calc(100% - 1.5rem);
    margin-inline: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: color-mix(in oklab, var(--md-surface), transparent 4%);
    box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
}

.image-controls label:first-child {
    width: min(15rem, 42vw);
}

.image-size {
    width: min(9rem, 28vw);
}
</style>
