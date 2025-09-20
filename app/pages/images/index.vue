<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { FileMeta } from '~/db/schema';
import { listImageMetasPaged } from '~/db/files-select';

const PAGE_SIZE = 50;
const items = ref<FileMeta[]>([]);
const offset = ref(0);
const loading = ref(false);
const done = ref(false);

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
</script>

<template>
    <div class="p-4">
        <h1 class="text-xl font-semibold mb-4">Images</h1>
        <div
            class="grid gap-3"
            style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
        >
            <div
                v-for="m in items"
                :key="m.hash"
                class="border rounded overflow-hidden bg-white/5"
            >
                <div class="w-full bg-black/5" :style="aspectStyle(m)"></div>
                <div class="px-2 py-1 text-sm truncate" :title="m.name">
                    {{ m.name }}
                </div>
            </div>
        </div>
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
    </div>
</template>

<style scoped></style>
