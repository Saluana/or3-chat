<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, watch, ref } from 'vue';
import type { FileMeta } from '../../db/schema';
import { getFileBlob } from '../../db/files';

const props = defineProps<{
    items: FileMeta[];
    selectionMode?: boolean;
    selectedHashes?: Set<string>;
    isDeleting?: boolean;
}>();

const emit = defineEmits<{
    (e: 'view', meta: FileMeta): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
    (e: 'toggle-select', hash: string): void;
    (e: 'delete', meta: FileMeta): void;
}>();

type State = {
    urlByHash: Record<string, string | undefined>;
    errorByHash: Record<string, boolean | undefined>;
};

const state = reactive<State>({ urlByHash: {}, errorByHash: {} });
const container = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;

function isSelected(hash: string): boolean {
    return props.selectedHashes?.has?.(hash) ?? false;
}

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

function toggleSelect(hash: string) {
    if (!hash || props.isDeleting) return;
    emit('toggle-select', hash);
}

function deleteMeta(meta: FileMeta) {
    if (props.isDeleting) return;
    emit('delete', meta);
}
</script>

<template>
    <div
        ref="container"
        class="grid gap-3 max-w-[1400px] mx-auto"
        style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
    >
        <div
            v-for="m in items"
            :key="m.hash"
            :data-hash="m.hash"
            class="border-2 rounded-md overflow-hidden transition-colors"
            :class="
                props.selectionMode && isSelected(m.hash)
                    ? 'border-[var(--md-primary)] shadow-[2px_2px_0_var(--md-primary)]'
                    : 'border-[var(--md-outline-variant)] shadow-[2px_2px_0_var(--md-outline)]'
            "
        >
            <div class="relative w-full bg-black/5" :style="aspectStyle(m)">
                <UButton
                    v-if="props.selectionMode"
                    type="button"
                    size="sm"
                    square
                    class="retro-btn absolute z-[1000] top-2 left-2 flex items-center justify-center hover:backdrop-blur-md"
                    :aria-pressed="isSelected(m.hash)"
                    role="checkbox"
                    :aria-checked="isSelected(m.hash)"
                    :title="
                        isSelected(m.hash)
                            ? `Deselect ${m.name}`
                            : `Select ${m.name}`
                    "
                    @click.stop="toggleSelect(m.hash)"
                >
                    <UIcon
                        :name="
                            isSelected(m.hash)
                                ? 'pixelarticons:check'
                                : 'pixelarticons:plus'
                        "
                        class="h-5 w-5"
                    />
                </UButton>
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
                <button
                    class="underline text-[var(--md-error)] disabled:opacity-60"
                    :disabled="props.isDeleting"
                    @click="deleteMeta(m)"
                >
                    Delete
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped></style>
