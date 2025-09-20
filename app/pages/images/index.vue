<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { FileMeta } from '../../db/schema';
import { listImageMetasPaged, updateFileName } from '../../db/files-select';
import { getFileBlob } from '../../db/files';
import GalleryGrid from './GalleryGrid.vue';
import ImageViewer from './ImageViewer.vue';

const PAGE_SIZE = 50;
const items = ref<FileMeta[]>([]);
const offset = ref(0);
const loading = ref(false);
const done = ref(false);
const showViewer = ref(false);
const selected = ref<FileMeta | null>(null);

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
</script>

<template>
    <div class="p-4">
        <h1 class="text-xl font-semibold mb-4">Images</h1>
        <GalleryGrid
            :items="items"
            @view="handleView"
            @download="handleDownload"
            @copy="handleCopy"
            @rename="handleRename"
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
        />
    </div>
</template>

<style scoped></style>
