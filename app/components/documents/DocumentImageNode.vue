<template>
    <NodeViewWrapper
        class="or3-document-image"
        :class="{ 'is-selected': selected }"
        :style="{ '--image-width': `${imageWidth}%` }"
        :data-align="alignment"
    >
        <div class="image-frame" data-drag-handle>
            <div v-if="loading" class="image-placeholder">Loading image…</div>
            <img
                v-else-if="objectUrl"
                :src="objectUrl"
                :alt="node.attrs.alt || ''"
                draggable="false"
            />
            <div v-else class="image-placeholder image-error">Image unavailable</div>
        </div>
        <div v-if="selected" class="image-controls" contenteditable="false">
            <label class="image-description">
                <span class="sr-only">Image alt text</span>
                <UInput
                    :model-value="node.attrs.alt || ''"
                    size="sm"
                    class="w-full"
                    aria-label="Image alt text"
                    placeholder="Describe this image"
                    @change="setAlt"
                />
            </label>
            <div class="image-size">
                <div class="image-size-heading">
                    <UIcon :name="resizeIcon" aria-hidden="true" />
                    <span>Resize</span>
                    <output>{{ imageWidth }}%</output>
                </div>
                <USlider
                    :min="25"
                    :max="100"
                    :step="5"
                    :model-value="imageWidth"
                    tooltip
                    aria-label="Image width"
                    @update:model-value="setWidth"
                />
            </div>
            <div class="image-alignment" role="group" aria-label="Image alignment">
                <UButton :icon="alignLeftIcon" :variant="alignment === 'left' ? 'soft' : 'ghost'" :aria-pressed="alignment === 'left'" color="neutral" size="sm" square aria-label="Align image left" title="Align image left" @click="setAlignment('left')" />
                <UButton :icon="alignCenterIcon" :variant="alignment === 'center' ? 'soft' : 'ghost'" :aria-pressed="alignment === 'center'" color="neutral" size="sm" square aria-label="Align image center" title="Align image center" @click="setAlignment('center')" />
                <UButton :icon="alignRightIcon" :variant="alignment === 'right' ? 'soft' : 'ghost'" :aria-pressed="alignment === 'right'" color="neutral" size="sm" square aria-label="Align image right" title="Align image right" @click="setAlignment('right')" />
            </div>
            <UButton color="error" variant="ghost" size="sm" label="Remove" aria-label="Remove image" @click="removeImage" />
        </div>
    </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';
import { getFileBlob } from '~/db/files';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { useIcon } from '~/composables/useIcon';

const props = defineProps<NodeViewProps>();
const objectUrl = ref('');
const loading = ref(false);
const resizeIcon = useIcon('editor.image.resize');
const alignLeftIcon = useIcon('editor.image.align-left');
const alignCenterIcon = useIcon('editor.image.align-center');
const alignRightIcon = useIcon('editor.image.align-right');
const alignment = computed(() => props.node.attrs.align === 'left' || props.node.attrs.align === 'right' ? props.node.attrs.align : 'center');
const imageWidth = computed(() => {
    const width = Number(props.node.attrs.width);
    return Number.isFinite(width) && width > 0 ? Math.min(100, width) : 100;
});

function releaseUrl() {
    if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = '';
}

// A node belongs to the document/editor scope in which it was mounted.
const ownerDb = getDb();
const ownerGeneration = getWorkspaceGeneration();
const ownerAccount = getCachedSessionContext()?.user?.id ?? null;
let requestRevision = 0;
let scopeValid = true;
let disposed = false;

function hasOwnerScope() {
    return scopeValid && !disposed && getDb() === ownerDb &&
        getWorkspaceGeneration() === ownerGeneration &&
        (getCachedSessionContext()?.user?.id ?? null) === ownerAccount;
}

function invalidateOwner() {
    scopeValid = false;
    requestRevision++;
    releaseUrl();
    loading.value = false;
}

async function loadImage(hash: string) {
    const revision = ++requestRevision;
    releaseUrl();
    loading.value = false;
    if (!hash || !hasOwnerScope()) return;
    loading.value = true;
    const current = () => revision === requestRevision && hasOwnerScope() &&
        String(props.node.attrs.hash || '') === hash;
    try {
        const blob = await getFileBlob(hash, ownerDb);
        if (blob && current()) objectUrl.value = URL.createObjectURL(blob);
    } catch {
        // The unavailable placeholder is also the local read failure state.
    } finally {
        if (current()) loading.value = false;
    }
}

const stopWorkspaceSubscription = subscribeActiveWorkspaceDb(invalidateOwner);
watch(() => getCachedSessionContext()?.user?.id ?? null, invalidateOwner, { flush: 'sync' });
watch(() => String(props.node.attrs.hash || ''), loadImage, { immediate: true });
onBeforeUnmount(() => {
    disposed = true;
    stopWorkspaceSubscription();
    invalidateOwner();
});

function setAlt(event: Event) {
    if (!props.editor.isEditable || !hasOwnerScope()) return;
    props.updateAttributes({ alt: (event.target as HTMLInputElement).value });
}

function setWidth(value: number | number[] | undefined) {
    if (!props.editor.isEditable || !hasOwnerScope()) return;
    const width = Array.isArray(value) ? value[0] : value;
    if (typeof width === 'number' && Number.isFinite(width)) props.updateAttributes({ width: Math.min(100, Math.max(25, width)) });
}

function setAlignment(align: 'left' | 'center' | 'right') {
    if (props.editor.isEditable && hasOwnerScope()) props.updateAttributes({ align });
}

function removeImage() {
    if (props.editor.isEditable && hasOwnerScope()) props.deleteNode();
}
</script>

<style scoped>
.or3-document-image {
    position: relative;
    width: 100%;
    margin: 1.5rem 0;
}

.image-frame {
    width: min(var(--image-width), 100%);
    margin-inline: auto;
}

.or3-document-image[data-align='left'] .image-frame { margin-inline-start: 0; }
.or3-document-image[data-align='right'] .image-frame { margin-inline-end: 0; }

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
    position: relative;
    z-index: 2;
    width: min(100%, 40rem);
    margin: 0.65rem auto 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border: max(1px, var(--md-border-width, 1px)) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: color-mix(in oklab, var(--md-surface), transparent 4%);
    box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
}

.image-description {
    flex: 1 1 10rem;
    min-width: 0;
}

.image-size {
    flex: 1 1 8rem;
    min-width: 6rem;
}

.image-size-heading {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-bottom: 0.25rem;
    font-size: 0.7rem;
    color: var(--md-on-surface-variant);
}

.image-size-heading output { margin-inline-start: auto; font-variant-numeric: tabular-nums; }
.image-alignment { display: flex; gap: 0.125rem; }
.image-controls :deep(button) { flex-shrink: 0; }
</style>
