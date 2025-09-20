<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, toRefs, watch, ref } from 'vue';
import type { FileMeta } from '../../db/schema';
import { getFileBlob } from '../../db/files';

const props = defineProps<{
    items: FileMeta[];
}>();

const emit = defineEmits<{
    (e: 'view', meta: FileMeta): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
}>();

type State = {
    urlByHash: Record<string, string | undefined>;
    errorByHash: Record<string, boolean | undefined>;
};

const state = reactive<State>({ urlByHash: {}, errorByHash: {} });
const container = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;

function aspectStyle(m: FileMeta) {
    const w = m.width ?? 1;
    const h = m.height ?? 1;
    return { aspectRatio: `${w} / ${h}` } as any;
}

async function ensureUrl(meta: FileMeta) {
    if (state.urlByHash[meta.hash] || state.errorByHash[meta.hash]) return;
    try {
        const blob = await getFileBlob(meta.hash);
        if (!blob) throw new Error('blob missing');
        const url = URL.createObjectURL(blob);
        state.urlByHash[meta.hash] = url;
    } catch {
        state.errorByHash[meta.hash] = true;
    }
}

function observe() {
    if (io) io.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    io = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    const hash = (e.target as HTMLElement).dataset['hash'];
                    const meta = props.items.find((m) => m.hash === hash);
                    if (meta) ensureUrl(meta);
                }
            }
        },
        { root: container.value, rootMargin: '200px 0px', threshold: 0.01 }
    );

    // Attach to tiles
    requestAnimationFrame(() => {
        container.value
            ?.querySelectorAll('[data-hash]')
            ?.forEach((el) => io?.observe(el));
    });
}

onMounted(() => {
    observe();
});

watch(
    () => props.items.map((i) => i.hash).join(','),
    () => {
        // re-observe when items change
        observe();
    }
);

onBeforeUnmount(() => {
    if (io) io.disconnect();
    // revoke URLs
    Object.values(state.urlByHash).forEach((u) => u && URL.revokeObjectURL(u));
});

function rename(meta: FileMeta) {
    emit('rename', meta);
}

function view(meta: FileMeta) {
    emit('view', meta);
}

function download(meta: FileMeta) {
    emit('download', meta);
}

function copy(meta: FileMeta) {
    emit('copy', meta);
}
</script>

<template>
    <div
        ref="container"
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
    >
        <div
            v-for="m in items"
            :key="m.hash"
            :data-hash="m.hash"
            class="border rounded overflow-hidden"
        >
            <div class="relative w-full bg-black/5" :style="aspectStyle(m)">
                <img
                    v-if="state.urlByHash[m.hash] && !state.errorByHash[m.hash]"
                    class="absolute inset-0 w-full h-full object-cover"
                    :src="state.urlByHash[m.hash]"
                    :alt="m.name"
                />
                <div
                    v-else
                    class="absolute inset-0 flex items-center justify-center text-xs opacity-60"
                >
                    <span>Preview unavailable</span>
                </div>
            </div>
            <div class="px-2 py-1 text-sm truncate" :title="m.name">
                {{ m.name }}
            </div>
            <div class="px-2 pb-2 flex gap-2 text-xs">
                <button class="underline" @click="view(m)">View</button>
                <button class="underline" @click="download(m)">Download</button>
                <button class="underline" @click="copy(m)">Copy</button>
                <button class="underline" @click="rename(m)">Rename</button>
            </div>
        </div>
    </div>
</template>

<style scoped></style>
