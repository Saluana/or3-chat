<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { FileMeta } from '../../db/schema';
import { listImageMetasPaged, updateFileName } from '../../db/files-select';
import { getFileBlob, softDeleteMany, fileDeleteError } from '../../db/files';
import GalleryGrid from './GalleryGrid.vue';
import ImageViewer from './ImageViewer.vue';
import { reportError } from '../../utils/errors';
import { useToast } from '#imports';

const PAGE_SIZE = 50;
const items = ref<FileMeta[]>([]);
const offset = ref(0);
const loading = ref(false);
const done = ref(false);
const showViewer = ref(false);
const selected = ref<FileMeta | null>(null);
const selectionMode = ref(false);
const selectedHashes = ref<Set<string>>(new Set());
const isDeleting = ref(false);
const toast = useToast();

const selectedCount = computed(() => selectedHashes.value.size);
const hasSelection = computed(() => selectedCount.value > 0);

async function loadMore() {
    if (loading.value || done.value) return;
    loading.value = true;
    try {
        const chunk = await listImageMetasPaged(offset.value, PAGE_SIZE);
        if (chunk.length < PAGE_SIZE) done.value = true;
        items.value.push(...chunk);
        offset.value += chunk.length;
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    loadMore();
});

function aspectStyle(m: FileMeta) {
    const w = m.width ?? 1;
    const h = m.height ?? 1;
    return { aspectRatio: `${w} / ${h}` } as any;
}

async function handleDownload(meta: FileMeta) {
    const blob = await getFileBlob(meta.hash);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.name || 'image';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function handleCopy(meta: FileMeta) {
    const blob = await getFileBlob(meta.hash);
    if (!blob) return;
    const mime = meta.mime_type || 'image/png';
    try {
        // @ts-ignore ClipboardItem may be missing from TS lib
        const item = new ClipboardItem({ [mime]: blob });
        await navigator.clipboard.write([item]);
    } catch {
        const url = URL.createObjectURL(blob);
        try {
            const res = await fetch(url);
            const ab = await res.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
            await navigator.clipboard.writeText(`data:${mime};base64,${b64}`);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

async function handleRename(meta: FileMeta) {
    const next = prompt('Rename image', meta.name);
    if (!next || next === meta.name) return;
    const old = meta.name;
    meta.name = next;
    try {
        await updateFileName(meta.hash, next);
    } catch {
        meta.name = old;
    }
}

function handleView(meta: FileMeta) {
    selected.value = meta;
    showViewer.value = true;
}

function toggleSelectionMode() {
    const next = !selectionMode.value;
    selectionMode.value = next;
    if (!next) clearSelection();
}

function clearSelection() {
    selectedHashes.value = new Set();
}

function toggleSelect(hash: string) {
    if (!hash) return;
    const next = new Set(selectedHashes.value);
    if (next.has(hash)) {
        next.delete(hash);
    } else {
        next.add(hash);
    }
    selectedHashes.value = next;
    if (next.size > 0) selectionMode.value = true;
}

function removeHashesFromState(hashes: string[]): number {
    if (!hashes.length) return 0;
    const removal = new Set(hashes);
    const before = items.value.length;
    items.value = items.value.filter((item) => !removal.has(item.hash));
    const removed = before - items.value.length;
    if (removed > 0) {
        offset.value = Math.max(0, offset.value - removed);
    }
    const nextSelected = new Set<string>();
    for (const hash of selectedHashes.value) {
        if (!removal.has(hash)) nextSelected.add(hash);
    }
    selectedHashes.value = nextSelected;
    if (selected.value && removal.has(selected.value.hash)) {
        selected.value = null;
        showViewer.value = false;
    }
    return removed;
}

async function executeDelete(
    hashes: string[],
    confirmMessage: string,
    successMessage: string
): Promise<boolean> {
    if (!hashes.length) return false;
    if (typeof window !== 'undefined') {
        const ok = window.confirm(confirmMessage);
        if (!ok) return false;
    }
    isDeleting.value = true;
    try {
        await softDeleteMany(hashes);
        const removed = removeHashesFromState(hashes);
        if (removed > 0) {
            toast.add({
                title: 'Images deleted',
                description: successMessage,
                color: 'success',
            });
        }
        return true;
    } catch (error) {
        reportError(fileDeleteError('Failed to delete images', error));
        return false;
    } finally {
        isDeleting.value = false;
    }
}

async function deleteSingle(meta: FileMeta | null) {
    if (!meta) return false;
    const name = meta.name || 'this image';
    const confirmMessage = `Delete "${name}"? This cannot be undone.`;
    const successMessage = `Removed "${name}".`;
    const success = await executeDelete(
        [meta.hash],
        confirmMessage,
        successMessage
    );
    if (success) {
        clearSelection();
        selectionMode.value = false;
    }
    return success;
}

async function deleteSelected() {
    const hashes = Array.from(selectedHashes.value);
    if (!hashes.length) return false;
    const count = hashes.length;
    const confirmMessage = `Delete ${count} image${
        count === 1 ? '' : 's'
    }? This cannot be undone.`;
    const successMessage = `${count} image${count === 1 ? '' : 's'} removed.`;
    const success = await executeDelete(hashes, confirmMessage, successMessage);
    if (success) {
        clearSelection();
        selectionMode.value = false;
        if (!done.value && items.value.length < PAGE_SIZE) {
            loadMore();
        }
    }
    return success;
}
</script>

<template>
    <div class="p-4 max-w-[1400px] mx-auto">
        <h1 class="text-xl font-semibold mb-4">Images</h1>
        <div
            v-if="items.length"
            class="mb-4 flex flex-wrap items-center gap-2 rounded-md border-2 border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)]/80 px-3 py-2"
        >
            <button
                class="retro-btn px-3 py-1 text-sm"
                type="button"
                @click="toggleSelectionMode"
                :disabled="isDeleting"
            >
                {{
                    selectionMode
                        ? 'Disable multi-select'
                        : 'Enable multi-select'
                }}
            </button>
            <button
                class="retro-btn px-3 py-1 text-sm"
                type="button"
                :disabled="!hasSelection || isDeleting"
                @click="clearSelection"
            >
                Clear selection
            </button>
            <button
                class="retro-btn px-3 py-1 text-sm"
                type="button"
                :disabled="!hasSelection || isDeleting"
                @click="deleteSelected"
            >
                {{
                    isDeleting
                        ? 'Deleting…'
                        : `Delete selected (${selectedCount})`
                }}
            </button>
            <span class="ml-auto text-sm opacity-80">
                Selected: {{ selectedCount }}
            </span>
        </div>
        <GalleryGrid
            :items="items"
            :selection-mode="selectionMode"
            :selected-hashes="selectedHashes"
            :is-deleting="isDeleting"
            @view="handleView"
            @download="handleDownload"
            @copy="handleCopy"
            @rename="handleRename"
            @delete="deleteSingle"
            @toggle-select="toggleSelect"
        />
        <div class="mt-4 flex justify-center">
            <button
                class="px-3 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                :disabled="loading || done"
                @click="loadMore"
            >
                <span v-if="!done">{{
                    loading ? 'Loading…' : 'Load more'
                }}</span>
                <span v-else>All loaded</span>
            </button>
        </div>
        <ImageViewer
            v-model="showViewer"
            :meta="selected"
            @download="handleDownload"
            @copy="handleCopy"
            @rename="handleRename"
            @delete="deleteSingle"
        />
    </div>
</template>

<style scoped></style>
