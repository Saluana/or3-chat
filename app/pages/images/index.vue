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

type DeleteOutcome = {
    attempted: string[];
    removed: string[];
    remaining: string[];
    aborted: boolean;
};

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
    let url: string | undefined;
    try {
        const blob = await getFileBlob(meta.hash);
        if (!blob) throw new Error('blob missing');
        url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = meta.name || 'image';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't download "${meta.name || 'image'}".`,
            tags: { domain: 'images', action: 'download', hash: meta.hash },
        });
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

async function handleCopy(meta: FileMeta) {
    let blob: Blob;
    try {
        const resolved = await getFileBlob(meta.hash);
        if (!resolved) throw new Error('blob missing');
        blob = resolved;
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't copy "${meta.name || 'image'}".`,
            tags: { domain: 'images', action: 'copy', hash: meta.hash },
        });
        return;
    }

    const mime = meta.mime_type || 'image/png';
    const showCopiedToast = () =>
        toast.add({
            title: 'Image copied',
            description: `${meta.name || 'Image'} is ready to paste.`,
            color: 'success',
        });
    try {
        // @ts-ignore ClipboardItem may be missing from TS lib
        const item = new ClipboardItem({ [mime]: blob });
        await navigator.clipboard.write([item]);
        showCopiedToast();
        return;
    } catch (primaryError) {
        const url = URL.createObjectURL(blob);
        try {
            const res = await fetch(url);
            const ab = await res.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
            await navigator.clipboard.writeText(`data:${mime};base64,${b64}`);
            showCopiedToast();
        } catch (fallbackError) {
            reportError(fallbackError || primaryError, {
                code: 'ERR_INTERNAL',
                message: `Couldn't copy "${meta.name || 'image'}".`,
                tags: {
                    domain: 'images',
                    action: 'copy',
                    hash: meta.hash,
                    stage: 'fallback',
                },
            });
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
    } catch (error) {
        meta.name = old;
        reportError(error, {
            code: 'ERR_DB_WRITE_FAILED',
            message: `Couldn't rename "${old}".`,
            tags: { domain: 'images', action: 'rename', hash: meta.hash },
        });
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

function removeHashesFromState(hashes: string[]) {
    if (!hashes.length) {
        return { removedHashes: [] as string[], remaining: [] as string[] };
    }
    const removal = new Set(hashes);
    const removedSet = new Set<string>();
    const before = items.value.length;
    items.value = items.value.filter((item) => {
        if (removal.has(item.hash)) {
            removedSet.add(item.hash);
            return false;
        }
        return true;
    });
    const removedCount = removedSet.size;
    if (removedCount > 0) {
        offset.value = Math.max(0, offset.value - removedCount);
    }
    const nextSelected = new Set<string>();
    for (const hash of selectedHashes.value) {
        if (!removedSet.has(hash)) nextSelected.add(hash);
    }
    selectedHashes.value = nextSelected;
    if (selected.value && removedSet.has(selected.value.hash)) {
        selected.value = null;
        showViewer.value = false;
    }
    const remaining = hashes.filter((hash) => !removedSet.has(hash));
    return { removedHashes: Array.from(removedSet), remaining };
}

async function executeDelete(
    hashes: string[],
    confirmMessage: string,
    successMessage: (count: number) => string
): Promise<DeleteOutcome> {
    const attempted = Array.from(new Set(hashes.filter(Boolean)));
    if (!attempted.length) {
        return { attempted, removed: [], remaining: [], aborted: true };
    }
    if (typeof window !== 'undefined') {
        const ok = window.confirm(confirmMessage);
        if (!ok) {
            return {
                attempted,
                removed: [],
                remaining: attempted,
                aborted: true,
            };
        }
    }
    isDeleting.value = true;
    try {
        await softDeleteMany(attempted);
        const { removedHashes, remaining } = removeHashesFromState(attempted);
        if (removedHashes.length > 0) {
            toast.add({
                title: 'Images deleted',
                description: successMessage(removedHashes.length),
                color: 'success',
            });
        }
        if (remaining.length > 0) {
            toast.add({
                title: 'Some images were not removed',
                description:
                    'A few selected items are still present. Please retry.',
                color: 'warning',
            });
        }
        return {
            attempted,
            removed: removedHashes,
            remaining,
            aborted: false,
        };
    } catch (error) {
        const wrapped = fileDeleteError('Failed to delete images', error);
        reportError(wrapped);
        toast.add({
            title: 'Delete failed',
            description: 'We could not remove the selected images.',
            color: 'error',
        });
        return {
            attempted,
            removed: [],
            remaining: attempted,
            aborted: false,
        };
    } finally {
        isDeleting.value = false;
    }
}

async function deleteSingle(meta: FileMeta | null) {
    if (!meta) return false;
    const name = meta.name || 'this image';
    const confirmMessage = `Delete "${name}"? This cannot be undone.`;
    const outcome = await executeDelete(
        [meta.hash],
        confirmMessage,
        () => `Removed "${name}".`
    );
    if (outcome.removed.length > 0 && outcome.remaining.length === 0) {
        clearSelection();
        selectionMode.value = false;
    }
    return outcome.removed.length > 0;
}

async function deleteSelected() {
    const hashes = Array.from(selectedHashes.value);
    if (!hashes.length) return false;
    const count = hashes.length;
    const confirmMessage = `Delete ${count} image${
        count === 1 ? '' : 's'
    }? This cannot be undone.`;
    const outcome = await executeDelete(
        hashes,
        confirmMessage,
        (removedCount) =>
            `${removedCount} image${removedCount === 1 ? '' : 's'} removed.`
    );
    if (outcome.removed.length > 0 && outcome.remaining.length === 0) {
        clearSelection();
        selectionMode.value = false;
        if (!done.value && items.value.length < PAGE_SIZE) {
            loadMore();
        }
    }
    return outcome.removed.length > 0;
}
</script>

<template>
    <div
        class="p-4 max-w-[1400px] mx-auto relative"
        :class="{ 'pb-24': selectionMode }"
    >
        <div class="flex justify-between">
            <h1 class="text-xl font-semibold mb-4">Images</h1>
            <UButton
                class=""
                type="button"
                data-test="multi-toggle"
                @click="toggleSelectionMode"
                :disabled="isDeleting"
            >
                <UIcon name="pixelarticons:image-multiple" class="mr-0.5" />
                {{ selectionMode ? 'Cancel' : 'Select' }}
            </UButton>
        </div>
        <div
            v-if="selectionMode"
            class="fixed inset-x-0 bottom-0 z-[1000] border-t-2 border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)]/80 backdrop-blur-md"
        >
            <div
                class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2"
            >
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    type="button"
                    data-test="multi-toggle"
                    @click="toggleSelectionMode"
                    :disabled="isDeleting"
                >
                    {{ selectionMode ? 'Cancel' : 'Select' }}
                </button>
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    type="button"
                    :disabled="!hasSelection || isDeleting"
                    @click="clearSelection"
                >
                    Clear
                </button>
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    type="button"
                    :disabled="!hasSelection || isDeleting"
                    data-test="delete-selected"
                    @click="deleteSelected"
                >
                    {{ isDeleting ? 'Deleting…' : `Delete (${selectedCount})` }}
                </button>
                <span
                    class="ml-auto text-sm opacity-80 hidden sm:inline"
                    data-test="selected-count"
                >
                    Selected: {{ selectedCount }}
                </span>
            </div>
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
